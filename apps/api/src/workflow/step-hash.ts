import { hashJSON, hashText } from "@forkloom/shared";
import type { RunCommandModel } from "../sandbox";
import type { ExecResult } from "../sandbox/ports";

export type StepHashInputEnvelope = {
	runId: string;
	stepName: string;
	attempt: number;
	command: {
		kind: RunCommandModel["kind"];
		payload: Record<string, unknown>;
	};
	cmdList: string[];
	sessionEntryIds: string[];
	artifactShas: string[];
};

export type StepHashOutputEnvelope = {
	runId: string;
	stepName: string;
	attempt: number;
	exec: {
		exitCode: number;
		status: ExecResult["status"];
		artifactWrites: string[];
		stdoutRef: string | null;
		stderrRef: string | null;
		workspaceRef: string | null;
		startedAt: string;
		endedAt: string;
	};
};

function sortStrings(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function toPointerShas(
	pointers: Array<{ sha256: string }> | undefined,
): string[] {
	if (!pointers || pointers.length === 0) {
		return [];
	}
	return sortStrings(
		pointers
			.map((pointer) => pointer.sha256)
			.filter((sha): sha is string => sha.length > 0),
	);
}

export function createStepHashInputEnvelope(input: {
	runId: string;
	stepName: string;
	attempt: number;
	command: RunCommandModel;
	exec: ExecResult;
	sessionEntryIds: string[];
}): StepHashInputEnvelope {
	return {
		runId: input.runId,
		stepName: input.stepName,
		attempt: input.attempt,
		command: {
			kind: input.command.kind,
			payload: input.command.payload,
		},
		cmdList: [...(input.exec.cmdList ?? [])],
		sessionEntryIds: sortStrings(input.sessionEntryIds),
		artifactShas: sortStrings([
			...toPointerShas(input.exec.artifactReads),
			...toPointerShas(input.exec.artifactWrites),
		]),
	};
}

export function createStepHashOutputEnvelope(input: {
	runId: string;
	stepName: string;
	attempt: number;
	exec: ExecResult;
}): StepHashOutputEnvelope {
	return {
		runId: input.runId,
		stepName: input.stepName,
		attempt: input.attempt,
		exec: {
			exitCode: input.exec.exitCode,
			status: input.exec.status,
			artifactWrites: toPointerShas(input.exec.artifactWrites),
			stdoutRef: input.exec.stdoutRef?.sha256 ?? null,
			stderrRef: input.exec.stderrRef?.sha256 ?? null,
			workspaceRef: input.exec.workspaceRef?.sha256 ?? null,
			startedAt: input.exec.startedAt,
			endedAt: input.exec.endedAt,
		},
	};
}

export function buildStepHashes(input: {
	runId: string;
	stepName: string;
	attempt: number;
	command: RunCommandModel;
	exec: ExecResult;
	sessionEntryIds: string[];
}): {
	stepKey: string;
	inHash: string;
	outHash: string;
} {
	const inEnvelope = createStepHashInputEnvelope({
		runId: input.runId,
		stepName: input.stepName,
		attempt: input.attempt,
		command: input.command,
		exec: input.exec,
		sessionEntryIds: input.sessionEntryIds,
	});
	const outEnvelope = createStepHashOutputEnvelope({
		runId: input.runId,
		stepName: input.stepName,
		attempt: input.attempt,
		exec: input.exec,
	});
	const inHash = hashJSON(inEnvelope);
	const outHash = hashJSON(outEnvelope);
	return {
		stepKey: hashText(
			`${input.runId}:${input.stepName}:${input.attempt}:${inHash}`,
		),
		inHash,
		outHash,
	};
}
