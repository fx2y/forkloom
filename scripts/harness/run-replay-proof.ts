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

function replayTimeoutMs(): number {
	const raw = process.env.RUN_REPLAY_TIMEOUT_MS;
	if (!raw) {
		return 300_000;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < 30_000) {
		throw new Error(
			`RUN_REPLAY_TIMEOUT_MS must be integer >= 30000, got: ${raw}`,
		);
	}
	return parsed;
}

async function main(): Promise<void> {
	const timeoutMs = replayTimeoutMs();
	await waitForApiHealthyStable({
		timeoutMs,
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
		timeoutMs,
		pollIntervalMs: 500,
	});
	const terminalState = await waitForRunTerminalState(spec.runId, {
		timeoutMs,
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
