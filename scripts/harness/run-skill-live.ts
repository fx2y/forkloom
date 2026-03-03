import { pathToFileURL } from "node:url";
import { waitForApiHealthyStable, writeJson } from "./live-support";
import { sleep } from "./live-support";
import {
	createRun,
	fetchArtifactBytes,
	fetchRunState,
	fetchRunTruth,
	makeRunSpec,
	queryRows,
} from "./run-live-support";

type SkillOutputArtifact = {
	kind: string;
	sha256: string;
};

function skillTimeoutMs(): number {
	const raw = process.env.RUN_SKILL_TIMEOUT_MS;
	if (!raw) {
		return 300_000;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < 30_000) {
		throw new Error(
			`RUN_SKILL_TIMEOUT_MS must be integer >= 30000, got: ${raw}`,
		);
	}
	return parsed;
}

async function decodeJsonArtifact<T>(sha256: string): Promise<T> {
	const bytes = await fetchArtifactBytes(sha256);
	return JSON.parse(bytes.toString("utf8")) as T;
}

async function waitForSkillExecEvidence(
	runId: string,
	timeoutMs: number,
): Promise<Awaited<ReturnType<typeof fetchRunTruth>>> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const truth = await fetchRunTruth(runId);
			const hasSkillExec = truth.links.some(
				(link) => link.stepName === "skill_exec",
			);
			const outputCount = truth.artifacts.filter(
				(artifact) => artifact.kind === "skill_output_file",
			).length;
			if (hasSkillExec && outputCount >= 2) {
				return truth;
			}
		} catch {
			// run may still be materializing /truth
		}
		await sleep(500);
	}
	throw new Error(
		`skill_exec evidence not ready before timeout for run ${runId}`,
	);
}

async function main(): Promise<void> {
	const timeoutMs = skillTimeoutMs();
	await waitForApiHealthyStable({
		timeoutMs,
		consecutiveSuccesses: 3,
		pollIntervalMs: 500,
		requireDeps: true,
	});
	const spec = makeRunSpec({
		userMsg:
			"/skill:meeting-to-actions ops:publish release checklist,qa:verify kill-resume report",
		profile: "safe",
	});
	await createRun(spec);
	const truth = await waitForSkillExecEvidence(spec.runId, timeoutMs);
	const runState = await fetchRunState(spec.runId);
	const skillLinks = truth.links.filter(
		(link) => link.stepName === "skill_exec",
	);
	if (skillLinks.length === 0) {
		throw new Error("missing skill_exec truth links");
	}
	const outputArtifacts: SkillOutputArtifact[] = truth.artifacts
		.filter((artifact) => artifact.kind === "skill_output_file")
		.map((artifact) => ({
			kind: artifact.kind,
			sha256: artifact.sha256,
		}));
	if (outputArtifacts.length < 2) {
		throw new Error(
			`expected >=2 skill output artifacts, got ${outputArtifacts.length}`,
		);
	}

	let actionsJson: Record<string, unknown> | null = null;
	let followThroughJson: Record<string, unknown> | null = null;
	for (const artifact of outputArtifacts) {
		const parsed = await decodeJsonArtifact<Record<string, unknown>>(
			artifact.sha256,
		);
		if (parsed.kind === "meeting_actions_v1") {
			actionsJson = parsed;
		}
		if (parsed.kind === "meeting_follow_through_stub_v1") {
			followThroughJson = parsed;
		}
	}
	if (!actionsJson) {
		throw new Error("missing meeting_actions_v1 output artifact");
	}
	if (!followThroughJson) {
		throw new Error("missing meeting_follow_through_stub_v1 output artifact");
	}
	const actionRows = Array.isArray(actionsJson.actions)
		? actionsJson.actions
		: [];
	if (actionRows.length < 2) {
		throw new Error(`expected >=2 action rows, got ${actionRows.length}`);
	}
	if (followThroughJson.launcher !== "enqueueActorTick") {
		throw new Error("follow-through launcher drift");
	}

	const dbRows = await queryRows<{
		count: string;
	}>(
		`select count(*)::text as count from steps where run_id = $1 and step_name='skill_exec';`,
		[spec.runId],
	);
	const dbStepCount = Number.parseInt(dbRows[0]?.count ?? "0", 10);
	if (!Number.isFinite(dbStepCount) || dbStepCount < 1) {
		throw new Error(`missing skill_exec step row in DB for run ${spec.runId}`);
	}

	await writeJson(".cache/spec08/skills-live-proof.json", {
		status: "ok",
		runId: spec.runId,
		runStatus: runState.status,
		skillExecStepCount: dbStepCount,
		skillExecLinkCount: skillLinks.length,
		skillOutputArtifacts: outputArtifacts,
		actionCount: actionRows.length,
		launcher: followThroughJson.launcher,
	});
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
