import {
	ActorEventStream,
	createActor,
	fetchActorState,
	makeActorSpec,
	postActorMessage,
	uploadArtifact,
	writeJson,
} from "./actor-live-support";
import { queryRows } from "./live-support";

function createActorId(): string {
	return `actor-live-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function main(): Promise<void> {
	const actorId = createActorId();
	await createActor(makeActorSpec(actorId, "functional"));
	const attachment = await uploadArtifact({
		body: "actor attachment proof\n",
		filename: "actor-functional.txt",
	});

	const stream = new ActorEventStream(actorId);
	try {
		const posted = await postActorMessage(actorId, {
			kind: "prompt",
			text: "reply with one concise line",
			attachments: [{ sha256: attachment.sha256 }],
		});
		const postedMailboxSeq =
			typeof posted.payload.seq === "number" ? posted.payload.seq : null;
		const result = await stream.readUntil((current) =>
			current.events.some(
				(event) =>
					(event.kind === "mailbox_processed" ||
						event.kind === "mailbox_failed") &&
					event.payload.seq === postedMailboxSeq,
			),
		);
		const actorState = await fetchActorState(actorId);
		const actorRows = await queryRows<{
			status: string;
			mailbox_cursor: string;
			pi_session_id: string | null;
			pi_session_file: string | null;
		}>(
			`select status, mailbox_cursor::text, pi_session_id, pi_session_file
			 from actor
			 where actor_id = $1`,
			[actorId],
		);
		const actorRow = actorRows[0] ?? null;
		const queuedEvent =
			result.events.find((event) => event.kind === "mailbox_queued") ?? null;
		const processedEvent =
			result.events.find((event) => event.kind === "mailbox_processed") ?? null;

		await writeJson(".cache/test-int/actor-functional.json", {
			actorId,
			attachmentSha256: attachment.sha256,
			posted,
			eventKinds: result.events.map((event) => event.kind),
			eventSeqs: result.events.map((event) => event.seq),
			actorState,
			actorRow,
			queuedEvent,
			processedEvent,
		});
	} finally {
		stream.close();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
