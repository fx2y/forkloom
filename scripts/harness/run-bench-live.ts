import { readFile } from "node:fs/promises";
import {
	makeRunSpec,
	runLiveFlow,
	uploadArtifactFile,
	writeJson,
} from "./run-live-support";

type BenchLatencyProof = {
	concurrency: number;
	totalElapsedMs: number;
	avgElapsedMs: number;
	maxElapsedMs: number;
	avgRunStartedLatencyMs: number;
	runs: Array<{
		runId: string;
		elapsedMs: number;
		runStartedLatencyMs: number;
		sessionArtifactSha256: string;
		stats: Record<string, unknown>;
	}>;
};

const mode = process.argv[2] ?? "latency";

function extractTotalTokens(stats: Record<string, unknown>): number {
	if (typeof stats.totalTokens === "number") {
		return stats.totalTokens;
	}
	const tokens = stats.tokens;
	if (
		tokens &&
		typeof tokens === "object" &&
		typeof (tokens as { total?: unknown }).total === "number"
	) {
		return (tokens as { total: number }).total;
	}
	return 0;
}

function extractCostUsd(stats: Record<string, unknown>): number {
	if (typeof stats.costUsd === "number") {
		return stats.costUsd;
	}
	if (typeof stats.cost === "number") {
		return stats.cost;
	}
	return 0;
}

async function runLatency(): Promise<void> {
	const attachment = await uploadArtifactFile("README.md");
	const concurrency = 10;
	const benchStart = performance.now();
	const runs = await Promise.all(
		Array.from({ length: concurrency }, async (_, index) => {
			const startedAt = performance.now();
			const proof = await runLiveFlow({
				spec: makeRunSpec({
					userMsg: `reply with a concise run summary #${index + 1}`,
					attachments: [attachment.sha256],
				}),
			});
			const runDone = proof.events.find((event) => event.kind === "run_done");
			return {
				runId: proof.runId,
				elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
				runStartedLatencyMs: proof.runStartedLatencyMs,
				sessionArtifactSha256: proof.sessionArtifactSha256,
				stats:
					runDone &&
					typeof runDone.payload.stats === "object" &&
					runDone.payload.stats
						? (runDone.payload.stats as Record<string, unknown>)
						: {},
			};
		}),
	);
	const totalElapsedMs = Number((performance.now() - benchStart).toFixed(3));
	const avgElapsedMs =
		runs.reduce((sum, run) => sum + run.elapsedMs, 0) / runs.length;
	const maxElapsedMs = Math.max(...runs.map((run) => run.elapsedMs));
	const avgRunStartedLatencyMs =
		runs.reduce((sum, run) => sum + run.runStartedLatencyMs, 0) / runs.length;

	await writeJson(".cache/bench/latency.json", {
		concurrency,
		totalElapsedMs,
		avgElapsedMs: Number(avgElapsedMs.toFixed(3)),
		maxElapsedMs: Number(maxElapsedMs.toFixed(3)),
		avgRunStartedLatencyMs: Number(avgRunStartedLatencyMs.toFixed(3)),
		runs,
	} satisfies BenchLatencyProof);
}

async function runCost(): Promise<void> {
	const parsed = JSON.parse(
		await readFile(".cache/bench/latency.json", "utf8"),
	) as BenchLatencyProof;
	const totalTokens = parsed.runs.reduce((sum, run) => {
		return sum + extractTotalTokens(run.stats);
	}, 0);
	const totalCostUsd = parsed.runs.reduce((sum, run) => {
		return sum + extractCostUsd(run.stats);
	}, 0);

	await writeJson(".cache/bench/cost.json", {
		concurrency: parsed.concurrency,
		runs: parsed.runs.map((run) => ({
			runId: run.runId,
			sessionArtifactSha256: run.sessionArtifactSha256,
			stats: run.stats,
		})),
		totalTokens,
		totalCostUsd: Number(totalCostUsd.toFixed(6)),
	});
}

async function main(): Promise<void> {
	if (mode === "latency") {
		await runLatency();
		return;
	}
	if (mode === "cost") {
		await runCost();
		return;
	}
	throw new Error(`unsupported mode: ${mode}`);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
