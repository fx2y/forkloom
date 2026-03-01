import { pathToFileURL } from "node:url";
import type { TruthBundle } from "@forkloom/contracts";
import {
	assertEqualShaSets,
	listReplayStepPayloads,
	readReplayConfig,
} from "../../apps/api/src/workflow/replay";
import { apiOrigin, readJson, writeJson } from "./live-support";

function usage(): never {
	throw new Error(
		"usage: tsx scripts/harness/run-replay.ts <run-id> [stub|debug] [output.json]",
	);
}

function toStepArtifactSet(
	truth: TruthBundle,
	attempts: Set<number>,
): Set<string> {
	const set = new Set<string>();
	for (const link of truth.links) {
		if (link.stepName !== "run_command" || !attempts.has(link.attempt)) {
			continue;
		}
		for (const sha256 of link.artifactShas) {
			set.add(sha256);
		}
	}
	return set;
}

async function fetchTruth(runId: string): Promise<TruthBundle> {
	const response = await fetch(`${apiOrigin()}/runs/${runId}/truth`);
	return readJson<TruthBundle>(response, `fetch truth ${runId}`);
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
	const expectedSet = toStepArtifactSet(truth, replayAttempts);
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
