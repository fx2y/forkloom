import type { TruthBundle } from "@forkloom/contracts";
import type { StepPayloadModel } from "../run/ports";

export type ReplayMode = "stub" | "debug";

export type ReplayConfig = {
	enabled: boolean;
	sourceRunId: string | null;
	mode: ReplayMode;
	attempt: number | null;
};

export type ReplayStepPayload = {
	runId: string;
	stepName: string;
	attempt: number;
	commandSeq: number;
	commandKind: string;
	commandPayload: Record<string, unknown>;
	exec: {
		exitCode: number;
		status: string;
		startedAt: string;
		endedAt: string;
		cmdList: string[];
		artifactReads: Array<{ sha256: string }>;
		artifactWrites: Array<{ sha256: string }>;
		workspaceRef?: { sha256: string } | undefined;
	};
	session: {
		sessionId: string;
		sessionFile: string;
		sessionArtifactSha: string;
		sessionEntryIds: string[];
		entryCount: number;
		rootId?: string | undefined;
		leafId?: string | undefined;
		summaryEntryCount: number;
	} | null;
};

function toFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toShaPointerArray(value: unknown): Array<{ sha256: string }> | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const parsed: Array<{ sha256: string }> = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) {
			return null;
		}
		const sha256 = (item as Record<string, unknown>).sha256;
		if (typeof sha256 !== "string" || sha256.length === 0) {
			return null;
		}
		parsed.push({ sha256 });
	}
	return parsed;
}

function toStringArray(value: unknown): string[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const parsed: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") {
			return null;
		}
		parsed.push(item);
	}
	return parsed;
}

function toStringRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

export function readReplayConfig(
	env: NodeJS.ProcessEnv = process.env,
): ReplayConfig {
	const sourceRunId = env.REPLAY_RUN_ID?.trim() ?? "";
	const modeRaw = env.REPLAY_MODE?.trim() ?? "stub";
	const mode: ReplayMode = modeRaw === "debug" ? "debug" : "stub";
	const attemptRaw = env.REPLAY_ATTEMPT?.trim() ?? "";
	const parsedAttempt = attemptRaw.length > 0 ? Number(attemptRaw) : Number.NaN;
	return {
		enabled: sourceRunId.length > 0,
		sourceRunId: sourceRunId.length > 0 ? sourceRunId : null,
		mode,
		attempt:
			Number.isFinite(parsedAttempt) && parsedAttempt >= 1
				? Math.trunc(parsedAttempt)
				: null,
	};
}

export function toReplayStepPayload(
	model: StepPayloadModel,
): ReplayStepPayload | null {
	const payload = toStringRecord(model.payload);
	if (!payload) {
		return null;
	}
	const commandSeq = toFiniteNumber(payload.commandSeq);
	const commandKind = payload.commandKind;
	const commandPayload = toStringRecord(payload.commandPayload);
	const execRecord = toStringRecord(payload.exec);
	if (
		commandSeq == null ||
		typeof commandKind !== "string" ||
		!commandPayload ||
		!execRecord
	) {
		return null;
	}

	const exitCode = toFiniteNumber(execRecord.exitCode);
	const status = execRecord.status;
	const startedAt = execRecord.startedAt;
	const endedAt = execRecord.endedAt;
	const cmdList = toStringArray(execRecord.cmdList);
	const artifactReads = toShaPointerArray(execRecord.artifactReads);
	const artifactWrites = toShaPointerArray(execRecord.artifactWrites);
	if (
		exitCode == null ||
		typeof status !== "string" ||
		typeof startedAt !== "string" ||
		typeof endedAt !== "string" ||
		!cmdList ||
		!artifactReads ||
		!artifactWrites
	) {
		return null;
	}

	const workspaceRefRecord = toStringRecord(execRecord.workspaceRef);
	const workspaceRefSha = workspaceRefRecord?.sha256;
	const workspaceRef =
		typeof workspaceRefSha === "string" && workspaceRefSha.length > 0
			? { sha256: workspaceRefSha }
			: undefined;

	const sessionRecord = toStringRecord(payload.session);
	let session: ReplayStepPayload["session"] = null;
	if (sessionRecord) {
		const sessionId = sessionRecord.sessionId;
		const sessionFile = sessionRecord.sessionFile;
		const sessionArtifactSha = sessionRecord.sessionArtifactSha;
		const sessionEntryIds = toStringArray(sessionRecord.sessionEntryIds);
		const entryCount = toFiniteNumber(sessionRecord.entryCount);
		const rootId = sessionRecord.rootId;
		const leafId = sessionRecord.leafId;
		const summaryEntryCount = toFiniteNumber(sessionRecord.summaryEntryCount);
		if (
			typeof sessionId === "string" &&
			typeof sessionFile === "string" &&
			typeof sessionArtifactSha === "string" &&
			sessionEntryIds &&
			entryCount != null &&
			summaryEntryCount != null
		) {
			session = {
				sessionId,
				sessionFile,
				sessionArtifactSha,
				sessionEntryIds,
				entryCount,
				rootId: typeof rootId === "string" ? rootId : undefined,
				leafId: typeof leafId === "string" ? leafId : undefined,
				summaryEntryCount,
			};
		}
	}

	return {
		runId: model.runId,
		stepName: model.stepName,
		attempt: model.attempt,
		commandSeq: Math.trunc(commandSeq),
		commandKind,
		commandPayload,
		exec: {
			exitCode: Math.trunc(exitCode),
			status,
			startedAt,
			endedAt,
			cmdList,
			artifactReads,
			artifactWrites,
			workspaceRef,
		},
		session,
	};
}

export function listReplayStepPayloads(
	stepPayloads: StepPayloadModel[],
): ReplayStepPayload[] {
	return stepPayloads
		.map(toReplayStepPayload)
		.filter((entry): entry is ReplayStepPayload => entry != null)
		.sort((a, b) => a.attempt - b.attempt);
}

export function selectReplayStepPayload(
	stepPayloads: ReplayStepPayload[],
	attempt: number | null,
): ReplayStepPayload | null {
	if (stepPayloads.length === 0) {
		return null;
	}
	if (attempt == null) {
		return stepPayloads[0] ?? null;
	}
	return stepPayloads.find((entry) => entry.attempt === attempt) ?? null;
}

export function artifactSetFromTruthBundle(truth: TruthBundle): Set<string> {
	return new Set(truth.artifacts.map((artifact) => artifact.sha256));
}

export function artifactSetFromReplayPayloads(
	stepPayloads: ReplayStepPayload[],
): Set<string> {
	const set = new Set<string>();
	for (const payload of stepPayloads) {
		for (const pointer of payload.exec.artifactWrites) {
			set.add(pointer.sha256);
		}
		if (payload.session?.sessionArtifactSha) {
			set.add(payload.session.sessionArtifactSha);
		}
	}
	return set;
}

export function assertEqualShaSets(
	expected: Set<string>,
	actual: Set<string>,
): void {
	if (
		expected.size === actual.size &&
		[...expected].every((sha) => actual.has(sha))
	) {
		return;
	}
	const missing = [...expected].filter((sha) => !actual.has(sha)).sort();
	const extra = [...actual].filter((sha) => !expected.has(sha)).sort();
	throw new Error(
		`artifact drift missing=${missing.join(",") || "-"} extra=${extra.join(",") || "-"}`,
	);
}
