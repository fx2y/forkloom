import {
	ActorEventStream,
	createActor,
	fetchActorState,
	makeActorSpec,
	postActorMessage,
	restartApi,
	writeJson,
} from "./actor-live-support";
import { queryRows } from "./live-support";

function createActorId(): string {
	return `actor-steer-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

function eventSeq(event: { payload: Record<string, unknown> }): number | null {
	return typeof event.payload.seq === "number" ? event.payload.seq : null;
}

async function readUntilProcessed(
	actorId: string,
	sinceEventId: number,
	targetMailboxSeq: number,
) {
	const stream = new ActorEventStream(actorId, { lastEventId: sinceEventId });
	try {
		return await stream.readUntil((current) =>
			current.events.some(
				(event) =>
					event.kind === "mailbox_processed" &&
					eventSeq(event as { payload: Record<string, unknown> }) ===
						targetMailboxSeq,
			),
		);
	} finally {
		stream.close();
	}
}

async function loadActorRow(actorId: string) {
	const rows = await queryRows<{
		status: string;
		pi_session_id: string | null;
		pi_session_file: string | null;
	}>(
		`select status, pi_session_id, pi_session_file
		 from actor
		 where actor_id = $1`,
		[actorId],
	);
	return rows[0] ?? null;
}

async function main(): Promise<void> {
	const actorId = createActorId();
	await createActor(makeActorSpec(actorId, "steer"));

	const promptPosted = await postActorMessage(actorId, {
		kind: "prompt",
		text: "reply with a short sentence",
		attachments: [],
	});
	const promptMailboxSeq = eventSeq(
		promptPosted as { payload: Record<string, unknown> },
	);
	if (promptMailboxSeq == null) {
		throw new Error("prompt mailbox seq missing from queued event");
	}
	const promptResult = await readUntilProcessed(actorId, 0, promptMailboxSeq);
	const promptEvent =
		promptResult.events.find(
			(event) =>
				event.kind === "mailbox_processed" && event.payload.seq === promptMailboxSeq,
		) ?? null;
	const stateAfterPrompt = await fetchActorState(actorId);
	const rowAfterPrompt = await loadActorRow(actorId);

	await restartApi();

	const followUpPosted = await postActorMessage(actorId, {
		kind: "followUp",
		text: "then say done",
		attachments: [],
	});
	const followUpMailboxSeq = eventSeq(
		followUpPosted as { payload: Record<string, unknown> },
	);
	if (followUpMailboxSeq == null) {
		throw new Error("followUp mailbox seq missing from queued event");
	}
	const followUpResult = await readUntilProcessed(
		actorId,
		promptResult.events.at(-1)?.seq ?? promptPosted.seq,
		followUpMailboxSeq,
	);

	const steerPosted = await postActorMessage(actorId, {
		kind: "steer",
		text: "interrupt after the current step",
		attachments: [],
	});
	const steerMailboxSeq = eventSeq(
		steerPosted as { payload: Record<string, unknown> },
	);
	if (steerMailboxSeq == null) {
		throw new Error("steer mailbox seq missing from queued event");
	}
	const steerResult = await readUntilProcessed(
		actorId,
		followUpResult.events.at(-1)?.seq ?? followUpPosted.seq,
		steerMailboxSeq,
	);

	const finalState = await fetchActorState(actorId);
	const rowAfterSteer = await loadActorRow(actorId);
	const followUpEvent =
		followUpResult.events.find(
			(event) =>
				event.kind === "mailbox_processed" &&
				event.payload.seq === followUpMailboxSeq,
		) ?? null;
	const steerEvent =
		steerResult.events.find(
			(event) =>
				event.kind === "mailbox_processed" && event.payload.seq === steerMailboxSeq,
		) ?? null;

	await writeJson(".cache/test-int/actor-steer-live.json", {
		actorId,
		promptPosted,
		followUpPosted,
		steerPosted,
		stateAfterPrompt,
		finalState,
		rowAfterPrompt,
		rowAfterSteer,
		promptEvent,
		followUpEvent,
		steerEvent,
		promptEventCount: promptResult.events.length,
		followUpEventCount: followUpResult.events.length,
		steerEventCount: steerResult.events.length,
	});
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
