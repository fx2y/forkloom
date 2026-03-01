import { pathToFileURL } from "node:url";
import type { TruthBundle } from "@forkloom/contracts";
import {
	type ReplayStepPayload,
	assertEqualShaSets,
	listReplayStepPayloads,
	readReplayConfig,
} from "../../apps/api/src/workflow/replay";
import { apiOrigin, fetchJsonWithRetry, writeJson } from "./live-support";

function usage(): never {
	throw new Error(
		"usage: tsx scripts/harness/run-replay.ts <run-id> [stub|debug] [output.json]",
	);
}

function toStepArtifactSet(
	truth: TruthBundle,
	replaySteps: ReplayStepPayload[],
): Set<string> {
	const replayKeys = new Set(
		replaySteps.map((step) => `${step.stepName}#${step.attempt}`),
	);
	const set = new Set<string>();
	for (const link of truth.links) {
		if (!replayKeys.has(`${link.stepName}#${link.attempt}`)) {
			continue;
		}
		for (const sha256 of link.artifactShas) {
			set.add(sha256);
		}
	}
	return set;
}

async function fetchTruth(runId: string): Promise<TruthBundle> {
	return fetchJsonWithRetry<TruthBundle>({
		url: `${apiOrigin()}/runs/${runId}/truth`,
		label: `fetch truth ${runId}`,
		maxAttempts: 10,
		retryDelayMs: 350,
		retryOnStatuses: [404, 502, 503, 504],
	});
}

export async function runReplayCheck(input: {
	runId: string;
	mode: "stub" | "debug";
	outputPath: string;
}): Promise<void> {
	const { runId, mode, outputPath } = input;
	process.env.REPLAY_RUN_ID = process.env.REPLAY_RUN_ID ?? runId;
	process.env.REPLAY_MODE = mode;
	const replayConfig = readReplayConfig(process.env);
	const truth = await fetchTruth(runId);
	const replaySteps = listReplayStepPayloads(truth.stepPayloads);
	if (replaySteps.length === 0) {
		throw new Error(`run ${runId} has no replayable step payloads`);
	}

	const replayAttempts = new Set(replaySteps.map((entry) => entry.attempt));
	const expectedSet = toStepArtifactSet(truth, replaySteps);
	const replaySet = new Set<string>();
	for (const step of replaySteps) {
		for (const pointer of step.exec.artifactReads) {
			replaySet.add(pointer.sha256);
		}
		for (const pointer of step.exec.artifactWrites) {
			replaySet.add(pointer.sha256);
		}
		if (step.session?.sessionArtifactSha) {
			replaySet.add(step.session.sessionArtifactSha);
		}
	}

	assertEqualShaSets(expectedSet, replaySet);
	await writeJson(outputPath, {
		runId,
		mode: replayConfig.mode,
		replaySourceRunId: replayConfig.sourceRunId,
		replayAttempts: [...replayAttempts],
		expectedCount: expectedSet.size,
		replayCount: replaySet.size,
		artifactShas: [...replaySet].sort(),
		status: "ok",
	});
}

async function main(): Promise<void> {
	const [runId, modeArg, outputArg] = process.argv.slice(2);
	if (!runId) {
		usage();
	}
	const mode = modeArg === "debug" ? "debug" : "stub";
	const outputPath = outputArg ?? ".cache/spec06/replay-cli.assert.json";
	await runReplayCheck({ runId, mode, outputPath });
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
