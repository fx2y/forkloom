import {
	ActorEventStream,
	createActor,
	makeActorSpec,
	postActorMessage,
	waitForActorStatus,
	writeJson,
} from "./actor-live-support";

function createActorId(): string {
	return `actor-sse-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

function toSeqList(events: Array<{ seq: number }>): number[] {
	return events.map((event) => event.seq);
}

async function main(): Promise<void> {
	const actorId = createActorId();
	await createActor(makeActorSpec(actorId, "sse"));

	const firstTab = new ActorEventStream(actorId);
	const secondTab = new ActorEventStream(actorId);
	try {
		await postActorMessage(actorId, {
			kind: "prompt",
			text: "reply with one concise line",
			attachments: [],
		});
		const prefix = await firstTab.readUntil(
			(current) => current.events.length >= 2,
			30_000,
		);
		const secondFullPromise = secondTab.readUntil((current) =>
			current.events.some((event) => event.kind === "mailbox_processed"),
		);
		const cursor = prefix.events[prefix.events.length - 1]?.seq;
		if (!cursor) {
			throw new Error("missing actor replay cursor");
		}

		firstTab.close();

		const replay = new ActorEventStream(actorId, { lastEventId: cursor });
		try {
			const replayTail = await replay.readUntil((current) =>
				current.events.some((event) => event.kind === "mailbox_processed"),
			);
			const secondFull = await secondFullPromise;
			const replayed = [...prefix.events, ...replayTail.events];
			const secondEvents = secondFull.events;

			if (replayTail.events.some((event) => event.seq <= cursor)) {
				throw new Error("actor replay emitted duplicate or stale seq");
			}
			if (new Set(toSeqList(replayed)).size !== replayed.length) {
				throw new Error("actor replay contains duplicate seq values");
			}
			if (toSeqList(replayed).join(",") !== toSeqList(secondEvents).join(",")) {
				throw new Error("actor two-tab replay diverged");
			}
			if (
				[
					...prefix.controlFrames,
					...replayTail.controlFrames,
					...secondFull.controlFrames,
				].some((frame) => frame.event === "gap")
			) {
				throw new Error(
					"actor SSE replay emitted unexpected gap control frame",
				);
			}

			await writeJson(".cache/test-int/actor-sse.json", {
				actorId,
				cursor,
				prefixSeqs: toSeqList(prefix.events),
				replaySeqs: toSeqList(replayTail.events),
				secondTabSeqs: toSeqList(secondEvents),
				actorState: await waitForActorStatus(actorId, "idle"),
			});
		} finally {
			replay.close();
		}
	} finally {
		firstTab.close();
		secondTab.close();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
