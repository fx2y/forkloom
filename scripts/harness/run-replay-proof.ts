import { pathToFileURL } from "node:url";
import { waitForApiHealthyStable, writeJson } from "./live-support";
import {
	createRun,
	makeRunSpec,
	queueRunCommand,
	uploadArtifactFile,
	waitForReplayablePayload,
	waitForRunTerminalState,
} from "./run-live-support";
import { runReplayCheck } from "./run-replay";

async function main(): Promise<void> {
	await waitForApiHealthyStable({
		timeoutMs: 120_000,
		consecutiveSuccesses: 3,
		pollIntervalMs: 500,
		requireDeps: true,
	});
	const attachment = await uploadArtifactFile("README.md");
	const spec = makeRunSpec({
		userMsg: "replay proof capture",
		attachments: [attachment.sha256],
		profile: "safe",
	});
	await createRun(spec);
	await queueRunCommand(spec.runId, {
		kind: "prompt",
		payload: { text: "replay proof command" },
	});
	const truth = await waitForReplayablePayload(spec.runId, {
		timeoutMs: 120_000,
		pollIntervalMs: 500,
	});
	const terminalState = await waitForRunTerminalState(spec.runId, {
		timeoutMs: 120_000,
		pollIntervalMs: 500,
	});
	await runReplayCheck({
		runId: spec.runId,
		mode: "stub",
		outputPath: ".cache/spec06/replay-cli.assert.json",
	});
	await writeJson(".cache/spec06/replay-proof.live-run.json", {
		runId: spec.runId,
		runStatus: terminalState.status,
		attachmentSha256s: [attachment.sha256],
		replayablePayloadCount: truth.stepPayloads.filter(
			(step) => step.stepName === "run_command",
		).length,
	});
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
