import {
	ActorEventStream,
	createActor,
	fetchActorState,
	makeActorSpec,
	postActorMessage,
	writeJson,
} from "./actor-live-support";
import { queryRows } from "./run-live-support";

function createActorId(): string {
	return `actor-live-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function main(): Promise<void> {
	const actorId = createActorId();
	await createActor(makeActorSpec(actorId, "functional"));

	const stream = new ActorEventStream(actorId);
	try {
		const posted = await postActorMessage(actorId, {
			kind: "prompt",
			text: "reply with one concise line",
			attachments: [],
		});
		const result = await stream.readUntil((current) =>
			current.events.some(
				(event) =>
					event.kind === "mailbox_processed" || event.kind === "mailbox_failed",
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

		await writeJson(".cache/test-int/actor-functional.json", {
			actorId,
			posted,
			eventKinds: result.events.map((event) => event.kind),
			eventSeqs: result.events.map((event) => event.seq),
			actorState,
			actorRow,
			processedEvent:
				result.events.find((event) => event.kind === "mailbox_processed") ??
				null,
		});
	} finally {
		stream.close();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
