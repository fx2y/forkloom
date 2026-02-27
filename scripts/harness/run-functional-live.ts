import {
	makeRunSpec,
	runLiveFlow,
	uploadArtifactFile,
	writeJson,
} from "./run-live-support";

async function main(): Promise<void> {
	const attachment = await uploadArtifactFile("README.md");
	const proof = await runLiveFlow({
		spec: makeRunSpec({
			userMsg: "reply with a concise operator-ready answer",
			attachments: [attachment.sha256],
		}),
	});

	if (proof.runStartedLatencyMs > 200) {
		throw new Error(
			`run_started latency exceeded 200ms: ${proof.runStartedLatencyMs}`,
		);
	}
	if (proof.controlFrames.some((frame) => frame.event === "gap")) {
		throw new Error("functional run emitted unexpected gap control frame");
	}
	const runDone = proof.events.find((event) => event.kind === "run_done");
	if (!runDone) {
		throw new Error("missing run_done event");
	}
	if (
		typeof runDone.payload.text !== "string" ||
		runDone.payload.text.length === 0
	) {
		throw new Error("run_done payload missing result text");
	}
	if (!Array.isArray(runDone.payload.artifacts)) {
		throw new Error("run_done payload missing artifact list");
	}
	if (!runDone.payload.artifacts.includes(proof.sessionArtifactSha256)) {
		throw new Error("run_done payload missing session artifact sha");
	}
	if (proof.runState.status !== "done") {
		throw new Error(`expected done run state, got ${proof.runState.status}`);
	}
	if (!proof.runState.piSessionId || !proof.runState.piSessionFile) {
		throw new Error("run state missing pi session pointers");
	}
	for (const sha256 of [
		...proof.attachmentSha256s,
		proof.sessionArtifactSha256,
	]) {
		if (
			!proof.runState.artifacts.some((artifact) => artifact.sha256 === sha256)
		) {
			throw new Error(`run state missing artifact ${sha256}`);
		}
	}

	await writeJson(".cache/test-int/run-functional.json", {
		runId: proof.runId,
		created: proof.created,
		runStartedLatencyMs: proof.runStartedLatencyMs,
		runState: proof.runState,
		runDone: runDone.payload,
		attachmentSha256s: proof.attachmentSha256s,
		sessionArtifactSha256: proof.sessionArtifactSha256,
	});
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
