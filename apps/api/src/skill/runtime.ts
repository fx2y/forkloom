import {
	buildGenericStepHashes,
	buildGenericStepPayload,
} from "../workflow/step-hash";
import {
	type SkillScriptRunResult,
	runSkillScript,
} from "./bash-runner";
import { parseSkillArgs } from "./args";
import type { SkillExecutionPlan } from "./types";

type ArtifactWriter = {
	putArtifact(input: {
		body: Buffer;
		mime: string;
		type: "raw" | "trace";
		meta?: Record<string, string> | undefined;
	}): Promise<{ sha256: string }>;
};

type RunTruthWriter = {
	linkArtifact(runId: string, sha256: string, kind: string): Promise<void>;
	appendArtifactWritten(
		runId: string,
		input: { sha256: string; kind: string },
	): Promise<void>;
	recordStepLedger(input: {
		runId: string;
		stepName: string;
		attempt: number;
		stepKey: string;
		inHash: string;
		outHash: string;
		startedAt: string;
		endedAt: string;
		sessionEntryIds: string[];
		artifactShas: string[];
		note: string;
		payload: Record<string, unknown>;
	}): Promise<void>;
};

export type DurableSkillExecDeps = {
	artifactService: ArtifactWriter;
	runService: RunTruthWriter;
	runScript?:
		| ((input: {
				skillPath: string;
				scriptPath: string;
				args: string[];
				timeoutMs?: number | undefined;
				maxBytesOut?: number | undefined;
		  }) => Promise<SkillScriptRunResult>)
		| undefined;
};

export type SkillExecLedgerRow = {
	stepName: string;
	attempt: number;
	scriptPath: string;
	status: "done" | "failed" | "aborted";
	exitCode: number;
	artifactShas: string[];
};

export async function executeSkillPlanDurably(input: {
	runId: string;
	commandSeq: number;
	commandKind: "prompt" | "followUp" | "steer";
	plan: SkillExecutionPlan;
	deps: DurableSkillExecDeps;
	timeoutMs?: number | undefined;
	maxBytesOut?: number | undefined;
}): Promise<SkillExecLedgerRow[]> {
	const scripts = [...new Set(input.plan.scripts)].sort((a, b) =>
		a.localeCompare(b),
	);
	if (scripts.length === 0) {
		return [];
	}
	const args = parseSkillArgs(input.plan.argsText);
	const runScript = input.deps.runScript ?? runSkillScript;
	const rows: SkillExecLedgerRow[] = [];
	for (const [index, scriptPath] of scripts.entries()) {
		const run = await runScript({
			skillPath: input.plan.skillPath,
			scriptPath,
			args,
			timeoutMs: input.timeoutMs,
			maxBytesOut: input.maxBytesOut,
		});
		const stdout = await input.deps.artifactService.putArtifact({
			body: Buffer.from(run.stdout, "utf8"),
			mime: "text/plain",
			type: "trace",
			meta: {
				"run.id": input.runId,
				"run.command.seq": String(input.commandSeq),
				"run.command.kind": input.commandKind,
				"run.skill.name": input.plan.skillName,
				"run.skill.script": run.scriptPath,
				"run.exec.stream": "stdout",
			},
		});
		const stderr = await input.deps.artifactService.putArtifact({
			body: Buffer.from(run.stderr, "utf8"),
			mime: "text/plain",
			type: "trace",
			meta: {
				"run.id": input.runId,
				"run.command.seq": String(input.commandSeq),
				"run.command.kind": input.commandKind,
				"run.skill.name": input.plan.skillName,
				"run.skill.script": run.scriptPath,
				"run.exec.stream": "stderr",
			},
		});
		await input.deps.runService.linkArtifact(
			input.runId,
			stdout.sha256,
			"skill_stdout",
		);
		await input.deps.runService.appendArtifactWritten(input.runId, {
			sha256: stdout.sha256,
			kind: "skill_stdout",
		});
		await input.deps.runService.linkArtifact(
			input.runId,
			stderr.sha256,
			"skill_stderr",
		);
		await input.deps.runService.appendArtifactWritten(input.runId, {
			sha256: stderr.sha256,
			kind: "skill_stderr",
		});
		const outputFiles: Array<{ path: string; sha256: string }> = [];
		for (const file of run.outputFiles) {
			const artifact = await input.deps.artifactService.putArtifact({
				body: file.body,
				mime: "application/octet-stream",
				type: "raw",
				meta: {
					"run.id": input.runId,
					"run.command.seq": String(input.commandSeq),
					"run.command.kind": input.commandKind,
					"run.skill.name": input.plan.skillName,
					"run.skill.script": run.scriptPath,
					"run.skill.output": file.path,
				},
			});
			outputFiles.push({ path: file.path, sha256: artifact.sha256 });
			await input.deps.runService.linkArtifact(
				input.runId,
				artifact.sha256,
				"skill_output_file",
			);
			await input.deps.runService.appendArtifactWritten(input.runId, {
				sha256: artifact.sha256,
				kind: "skill_output_file",
			});
		}
		const artifactShas = [
			stdout.sha256,
			stderr.sha256,
			...outputFiles.map((file) => file.sha256),
		];
		const stepName = "skill_exec";
		const attempt = input.commandSeq * 1_000 + index + 1;
		const stepInput = {
			commandSeq: input.commandSeq,
			commandKind: input.commandKind,
			skillName: input.plan.skillName,
			skillPath: input.plan.skillPath,
			scriptPath: run.scriptPath,
			args,
		};
		const stepOutput = {
			exitCode: run.exitCode,
			status: run.status,
			stdoutSha: stdout.sha256,
			stderrSha: stderr.sha256,
			stdoutBytes: run.stdoutBytes,
			stderrBytes: run.stderrBytes,
			outputFiles,
			startedAt: run.startedAt,
			endedAt: run.endedAt,
		};
		const { stepKey, inHash, outHash } = buildGenericStepHashes({
			runId: input.runId,
			stepName,
			attempt,
			stepInput,
			stepOutput,
		});
		await input.deps.runService.recordStepLedger({
			runId: input.runId,
			stepName,
			attempt,
			stepKey,
			inHash,
			outHash,
			startedAt: run.startedAt,
			endedAt: run.endedAt,
			sessionEntryIds: [],
			artifactShas,
			note: `step=skill_exec skill=${input.plan.skillName} script=${run.scriptPath} status=${run.status}`,
			payload: buildGenericStepPayload({
				stepInput,
				stepOutput,
			}),
		});
		rows.push({
			stepName,
			attempt,
			scriptPath: run.scriptPath,
			status: run.status,
			exitCode: run.exitCode,
			artifactShas,
		});
		if (run.status !== "done") {
			throw new Error(
				`skill script failed: ${input.plan.skillName}/${run.scriptPath} (${run.status})`,
			);
		}
	}
	return rows;
}
