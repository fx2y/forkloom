import type { RunEvent } from "@forkloom/contracts";
import {
	RunEventStream,
	makeRunSpec,
	uploadArtifactFile,
	writeJson,
} from "./run-live-support";
import { createRun, fetchRunState } from "./run-live-support";

function toSeqList(events: RunEvent[]): number[] {
	return events.map((event) => event.seq);
}

async function probeAutoClose(
	stream: RunEventStream,
	waitMs = 200,
): Promise<boolean> {
	return Promise.race([
		stream.waitClosed().then(() => true),
		new Promise<boolean>((resolve) => {
			setTimeout(() => resolve(false), waitMs);
		}),
	]);
}

async function main(): Promise<void> {
	const attachment = await uploadArtifactFile("README.md");
	const spec = makeRunSpec({
		userMsg: "reply with one concise line",
		attachments: [attachment.sha256],
	});
	await createRun(spec);

	const firstTab = new RunEventStream(spec.runId);
	const secondTab = new RunEventStream(spec.runId);

	try {
		const prefix = await firstTab.readUntil(
			(current) => current.events.length >= 2,
		);
		const secondFullPromise = secondTab.readUntil((current) =>
			current.events.some(
				(event) => event.kind === "run_done" || event.kind === "run_failed",
			),
		);
		const cursor = prefix.events[prefix.events.length - 1]?.seq;
		if (!cursor) {
			throw new Error("missing replay cursor");
		}

		firstTab.close();

		const replay = new RunEventStream(spec.runId, { lastEventId: cursor });
		try {
			const replayTail = await replay.readUntil((current) =>
				current.events.some(
					(event) => event.kind === "run_done" || event.kind === "run_failed",
				),
			);
			const secondFull = await secondFullPromise;
			const replayed = [...prefix.events, ...replayTail.events];
			const secondEvents = secondFull.events;

			if (replayTail.events.some((event) => event.seq <= cursor)) {
				throw new Error("replay emitted duplicate or stale seq");
			}
			if (new Set(toSeqList(replayed)).size !== replayed.length) {
				throw new Error("replayed stream contains duplicate seq values");
			}
			if (toSeqList(replayed).join(",") !== toSeqList(secondEvents).join(",")) {
				throw new Error("two-tab stream diverged from replay sequence");
			}
			if (
				[
					...prefix.controlFrames,
					...replayTail.controlFrames,
					...secondFull.controlFrames,
				].some((frame) => frame.event === "gap")
			) {
				throw new Error("live SSE replay emitted unexpected gap control frame");
			}
			const replayAutoClosed = await probeAutoClose(replay);
			const secondTabAutoClosed = await probeAutoClose(secondTab);

			await writeJson(".cache/test-int/run-sse.json", {
				runId: spec.runId,
				cursor,
				prefixSeqs: toSeqList(prefix.events),
				replaySeqs: toSeqList(replayTail.events),
				secondTabSeqs: toSeqList(secondEvents),
				runState: await fetchRunState(spec.runId),
				replayAutoClosed,
				secondTabAutoClosed,
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
