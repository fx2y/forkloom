import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { DBOS } from "@dbos-inc/dbos-sdk";
import {
	type ExtensionHostHooks,
	type PiSessionPort,
	type PiSessionState,
	type PiSessionStats,
	assertToolCallResultAdjacency,
	parseSessionJsonl,
} from "../pi";
import type { RunModel, RunRepo } from "../run/ports";
import type {
	RegisteredRunWorkflow,
	RunService,
	RunStepLedgerInput,
} from "../run/service";
import { WORKSPACE_SNAPSHOT_RULE, materializeSandboxInputs } from "../sandbox";
import type {
	ExecResult,
	RunCommandModel,
	RunnerBackend,
	SandboxModel,
	SandboxRepo,
} from "../sandbox";
import type { StagedSandboxInput } from "../sandbox/input-staging";
import type { ArtifactService } from "../service";
import {
	type SkillPromptResolution,
	createSandboxSkillRunner,
	executeSkillPlanDurably,
} from "../skill";
import { buildRunPromptInput } from "./prompt";
import {
	type ReplayStepPayload,
	listReplayStepPayloads,
	readReplayConfig,
	selectReplayStepPayload,
} from "./replay";
import { buildStepHashes } from "./step-hash";

type RunSandboxStepName =
	| "loadPlan"
	| "ensureSandbox"
	| "stageInputs"
	| "ensurePi"
	| "skillExec"
	| "applyCommand"
	| "collect"
	| "snapshot"
	| "release";

type RunSandboxStepRunner = {
	runStep<T>(
		name: RunSandboxStepName | "markFailed",
		fn: () => Promise<T>,
	): Promise<T>;
};

type LoadedPlan = {
	run: RunModel;
	sandbox: SandboxModel;
	command: RunCommandModel;
};

type CollectedCommand = {
	resultText: string;
	stats: PiSessionStats;
	sessionState: PiSessionState;
	sessionEntryIds: string[];
	sessionIndex: {
		entryCount: number;
		rootId?: string | undefined;
		leafId?: string | undefined;
		summaryEntryCount: number;
	};
	sessionArtifactSha: string;
	execResult: ExecResult;
	workspaceRef?: { sha256: string } | undefined;
};

export class RunTransientError extends Error {}

export type RunSandboxDeps = {
	runRepo: Pick<RunRepo, "getRun" | "listStepPayloads">;
	runService: Pick<
		RunService,
		| "appendArtifactWritten"
		| "appendPiEvent"
		| "appendRunEvent"
		| "beginRun"
		| "failRun"
		| "linkArtifact"
		| "recordStepLedger"
	>;
	skills?:
		| {
				buildAvailableSkillsXml(): Promise<string>;
				resolvePrompt?(input: {
					text: string;
					activationKind?: "explicit" | "implicit" | undefined;
				}): Promise<SkillPromptResolution>;
				resolvePromptText?(input: {
					text: string;
					activationKind?: "explicit" | "implicit" | undefined;
				}): Promise<string>;
		  }
		| undefined;
	extensions?: ExtensionHostHooks | undefined;
	artifactService: Pick<
		ArtifactService,
		"getArtifactBytes" | "getArtifactMeta" | "putArtifact"
	>;
	sandboxRepo: Pick<
		SandboxRepo,
		| "acquireLease"
		| "claimNextCommand"
		| "getSandbox"
		| "getCurrentCommand"
		| "markApproved"
		| "markCommandDead"
		| "persistExec"
		| "requeueCommand"
		| "releaseLease"
	>;
	backend: RunnerBackend;
	workflowLauncher: {
		startRunOnce(runId: string, opts: { workflowID: string }): Promise<void>;
	};
	createPiSession(run: RunModel, sandbox: SandboxModel): Promise<PiSessionPort>;
	readFileBytes?: ((path: string) => Promise<Buffer>) | undefined;
	leaseMs?: number | undefined;
	workflowId?: string | undefined;
};

const RUN_SANDBOX_LEASE_MS = 60_000;

const dbosStepRunner: RunSandboxStepRunner = {
	runStep<T>(
		name: RunSandboxStepName | "markFailed",
		fn: () => Promise<T>,
	): Promise<T> {
		return DBOS.runStep(fn, { name });
	},
};

function normalizeErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return String(error);
}

function isClaimOrLeaseLost(error: unknown): boolean {
	const message = normalizeErrorMessage(error);
	return (
		message.includes("persist exec: command claim lost") ||
		message.includes("persist exec: sandbox lease lost")
	);
}

function clockIso(): string {
	return new globalThis.Date().toISOString();
}

function requireWorkflowId(): string {
	if (!DBOS.workflowID) {
		throw new Error("RunSandboxTick requires DBOS workflowID");
	}
	return DBOS.workflowID;
}

export function toRunSandboxWorkflowId(
	runId: string,
	firstPendingSeq: number,
): string {
	return `run:${runId}:${firstPendingSeq}`;
}

function assertLoaded(value: LoadedPlan | null): LoadedPlan {
	if (!value) {
		throw new Error("run sandbox plan is not loaded");
	}
	return value;
}

function readCommandText(command: RunCommandModel): string {
	const text = command.payload.text;
	if (typeof text !== "string" || text.trim().length === 0) {
		throw new Error(`command ${command.kind} requires payload.text`);
	}
	return text.trim();
}

async function emitSessionBootstrap(input: {
	extensions?: ExtensionHostHooks | undefined;
	runId: string;
	sessionId?: string | undefined;
}): Promise<void> {
	if (!input.extensions) {
		return;
	}
	const branchEntries = input.extensions.readBranchEntries?.();
	const payload = {
		runId: input.runId,
		sessionId: input.sessionId,
		branchEntries,
	};
	await input.extensions.emitSessionStart(payload);
	await input.extensions.emitSessionTree(payload);
	await input.extensions.emitSessionFork(payload);
}

function normalizeResultText(value: string): string {
	const trimmed = value.trim();
	return trimmed.length > 0 ? value : "[no assistant text]";
}

function quoteShell(value: string): string {
	return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function toSessionTailCommand(
	sessionPath: string,
	maxBytesOut: number,
): [string, string, string] {
	return [
		"sh",
		"-lc",
		`if [ -f ${quoteShell(sessionPath)} ]; then tail -c ${maxBytesOut} ${quoteShell(sessionPath)}; fi`,
	];
}

function toSandboxSessionPath(runId: string, sandbox: SandboxModel): string {
	return `${sandbox.spec.piHomePath}/.pi/agent/sessions/${runId}.jsonl`;
}

function toCommandList(command: RunCommandModel): string[] {
	if (
		command.kind === "prompt" ||
		command.kind === "followUp" ||
		command.kind === "steer"
	) {
		return [command.kind, readCommandText(command)];
	}
	return [command.kind];
}

function toArtifactReads(run: RunModel): Array<{ sha256: string }> {
	return [
		...run.spec.attachments.map((pointer) => ({ sha256: pointer.sha256 })),
		...(run.spec.workdirRef ? [{ sha256: run.spec.workdirRef.sha256 }] : []),
	];
}

function withPointer(
	list: Array<{ sha256: string }>,
	pointer: { sha256: string } | undefined,
): Array<{ sha256: string }> {
	if (!pointer || list.some((entry) => entry.sha256 === pointer.sha256)) {
		return list;
	}
	return [...list, pointer];
}

function toLedgerArtifactShas(exec: ExecResult): string[] {
	const unique = new Set<string>();
	for (const read of exec.artifactReads ?? []) {
		unique.add(read.sha256);
	}
	for (const write of exec.artifactWrites ?? []) {
		unique.add(write.sha256);
	}
	return [...unique].sort((a, b) => a.localeCompare(b));
}

function buildFailureStepName(transient: boolean): string {
	return transient ? "run_command_requeue" : "run_command_dead";
}

function buildFailedCommandLedger(input: {
	run: RunModel;
	sandbox: SandboxModel;
	command: RunCommandModel;
	runId: string;
	startedAt?: string | undefined;
	errorMessage: string;
	transient: boolean;
}): RunStepLedgerInput {
	const endedAt = clockIso();
	const exec: ExecResult = {
		exitCode: -1,
		status: "failed",
		cmdList: toCommandList(input.command),
		artifactReads: toArtifactReads(input.run),
		artifactWrites: [],
		stdoutTail: "",
		stderrTail: "",
		stdoutBytes: 0,
		stderrBytes: 0,
		timeoutSec: input.sandbox.spec.timeoutSec,
		maxBytesOut: input.sandbox.spec.maxBytesOut,
		startedAt: input.startedAt ?? endedAt,
		endedAt,
	};
	const stepName = buildFailureStepName(input.transient);
	const { stepKey, inHash, outHash } = buildStepHashes({
		runId: input.runId,
		stepName,
		attempt: input.command.seq,
		command: input.command,
		exec,
		sessionEntryIds: [],
	});
	return {
		runId: input.runId,
		stepName,
		attempt: input.command.seq,
		stepKey,
		inHash,
		outHash,
		startedAt: exec.startedAt,
		endedAt: exec.endedAt,
		sessionEntryIds: [],
		artifactShas: toLedgerArtifactShas(exec),
		note: `step=${stepName} kind=${input.command.kind} status=failed`,
		payload: {
			commandSeq: input.command.seq,
			commandKind: input.command.kind,
			commandPayload: input.command.payload,
			transient: input.transient,
			error: input.errorMessage,
			note: input.errorMessage,
		},
	};
}

function toReplayCommandKind(kind: string): RunCommandModel["kind"] {
	switch (kind) {
		case "approve":
		case "prompt":
		case "followUp":
		case "steer":
		case "abort":
			return kind;
		default:
			return "prompt";
	}
}

function toReplayCommand(
	runId: string,
	workflowId: string,
	payload: ReplayStepPayload,
): RunCommandModel {
	return {
		runId,
		seq: payload.commandSeq,
		kind: toReplayCommandKind(payload.commandKind),
		payload: payload.commandPayload,
		dedupeKey: `replay:${payload.runId}:${payload.attempt}`,
		state: "claimed",
		claimedBy: workflowId,
		claimedAt: payload.exec.startedAt,
		leaseExpiresAt: null,
		doneAt: null,
		error: null,
		createdAt: payload.exec.startedAt,
	};
}

function toReplayCollected(
	run: RunModel,
	sandbox: SandboxModel,
	payload: ReplayStepPayload,
): CollectedCommand {
	const sessionEntryIds = payload.session?.sessionEntryIds ?? [];
	const sessionState: PiSessionState = {
		sessionId: payload.session?.sessionId ?? `replay:${run.runId}`,
		sessionFile: payload.session?.sessionFile ?? "/tmp/replay.session.jsonl",
		isStreaming: false,
		pending: 0,
	};
	return {
		resultText: normalizeResultText(
			typeof run.resultText === "string" ? run.resultText : "[replay]",
		),
		stats: run.resultStats ?? {},
		sessionState,
		sessionEntryIds,
		sessionIndex: {
			entryCount: payload.session?.entryCount ?? 0,
			rootId: payload.session?.rootId,
			leafId: payload.session?.leafId,
			summaryEntryCount: payload.session?.summaryEntryCount ?? 0,
		},
		sessionArtifactSha: payload.session?.sessionArtifactSha ?? "",
		execResult: {
			exitCode: payload.exec.exitCode,
			status:
				payload.exec.status === "running" ||
				payload.exec.status === "done" ||
				payload.exec.status === "failed" ||
				payload.exec.status === "aborted"
					? payload.exec.status
					: "done",
			cmdList: payload.exec.cmdList,
			artifactReads: payload.exec.artifactReads,
			artifactWrites: payload.exec.artifactWrites,
			stdoutTail: "",
			stderrTail: "",
			stdoutBytes: 0,
			stderrBytes: 0,
			timeoutSec: sandbox.spec.timeoutSec,
			maxBytesOut: sandbox.spec.maxBytesOut,
			startedAt: payload.exec.startedAt,
			endedAt: payload.exec.endedAt,
			workspaceRef: payload.exec.workspaceRef,
		},
		workspaceRef: payload.exec.workspaceRef,
	};
}

async function closeSession(session: PiSessionPort | null): Promise<void> {
	await session?.close().catch(() => undefined);
}

export async function executeRunSandbox(
	runId: string,
	deps: RunSandboxDeps,
	steps: RunSandboxStepRunner = dbosStepRunner,
): Promise<void> {
	const workflowId = deps.workflowId ?? requireWorkflowId();
	const leaseMs = deps.leaseMs ?? RUN_SANDBOX_LEASE_MS;
	const readFileBytes = deps.readFileBytes ?? readFile;
	const replay = readReplayConfig();
	let loadedPlan: LoadedPlan | null = null;
	let session: PiSessionPort | null = null;
	let startedAt: string | null = null;
	let nextPendingSeq: number | null = null;
	let nextWorkflowId: string | null = null;
	let stagedInputs: StagedSandboxInput[] = [];
	let replayPayload: ReplayStepPayload | null = null;
	let resolvedSkillText: string | null = null;

	if (replay.enabled) {
		const replaySourceRunId = replay.sourceRunId ?? runId;
		const replayPayloads = listReplayStepPayloads(
			await deps.runRepo.listStepPayloads(replaySourceRunId),
		);
		replayPayload = selectReplayStepPayload(replayPayloads, replay.attempt);
		if (!replayPayload) {
			throw new Error(
				`replay source has no run_command payloads: ${replaySourceRunId}`,
			);
		}
	}

	const getOrCreateSession = async (): Promise<PiSessionPort> => {
		if (!session) {
			session = await deps.createPiSession(
				assertLoaded(loadedPlan).run,
				assertLoaded(loadedPlan).sandbox,
			);
		}
		return session;
	};

	const resolveSkillPrompt = async (
		text: string,
	): Promise<SkillPromptResolution> => {
		if (deps.skills?.resolvePrompt) {
			return deps.skills.resolvePrompt({
				text,
				activationKind: "explicit",
			});
		}
		if (deps.skills?.resolvePromptText) {
			return {
				text: await deps.skills.resolvePromptText({
					text,
					activationKind: "explicit",
				}),
			};
		}
		return { text };
	};

	try {
		loadedPlan = await steps.runStep("loadPlan", async () => {
			if (replayPayload) {
				const run =
					(await deps.runRepo.getRun(runId)) ??
					(await deps.runRepo.getRun(replayPayload.runId));
				if (!run) {
					throw new Error(`run not found: ${runId}`);
				}
				const sandbox = await deps.sandboxRepo.getSandbox(runId);
				if (!sandbox) {
					throw new Error(`sandbox not found: ${runId}`);
				}
				const command = toReplayCommand(runId, workflowId, replayPayload);
				return { run, sandbox, command };
			}
			const acquired = await deps.sandboxRepo.acquireLease({
				runId,
				workflowId,
				leaseMs,
			});
			if (!acquired) {
				return null;
			}
			const command = await deps.sandboxRepo.claimNextCommand({
				runId,
				workflowId,
			});
			if (!command) {
				return null;
			}
			const run = await deps.runRepo.getRun(runId);
			if (!run) {
				throw new Error(`run not found: ${runId}`);
			}
			const sandbox = await deps.sandboxRepo.getSandbox(runId);
			if (!sandbox) {
				throw new Error(`sandbox not found: ${runId}`);
			}
			return { run, sandbox, command };
		});
		if (!loadedPlan) {
			return;
		}
		const activePlan = assertLoaded(loadedPlan);

		const liveSandbox = await steps.runStep("ensureSandbox", async () => {
			if (replayPayload) {
				return activePlan.sandbox;
			}
			return deps.backend.ensure(activePlan.sandbox.spec);
		});
		loadedPlan = { ...loadedPlan, sandbox: liveSandbox };

		await steps.runStep("stageInputs", async () => {
			if (replayPayload) {
				stagedInputs = [];
				return;
			}
			const sandbox = assertLoaded(loadedPlan).sandbox;
			const inputMount =
				sandbox.spec.mounts.find(
					(mount) => mount.kind === "inputs" && mount.dest === "/inputs",
				)?.source ?? sandbox.spec.piHomeHostDir;
			const staged = await materializeSandboxInputs({
				runId,
				attachments: assertLoaded(loadedPlan).run.spec.attachments,
				inputRoot: inputMount,
				appendRunId: false,
				artifactService: deps.artifactService,
			});
			stagedInputs = staged.staged;
		});

		if (assertLoaded(loadedPlan).command.kind !== "approve") {
			await steps.runStep("ensurePi", async () => undefined);
		} else {
			await steps.runStep("ensurePi", async () => undefined);
		}

		await steps.runStep("skillExec", async () => {
			if (replayPayload) {
				resolvedSkillText = null;
				return null;
			}
			const loaded = assertLoaded(loadedPlan);
			if (
				loaded.command.kind !== "prompt" &&
				loaded.command.kind !== "followUp" &&
				loaded.command.kind !== "steer"
			) {
				resolvedSkillText = null;
				return null;
			}
			const resolved = await resolveSkillPrompt(
				readCommandText(loaded.command),
			);
			resolvedSkillText = resolved.text;
			if (!resolved.execution || resolved.execution.scripts.length === 0) {
				return {
					skillName: resolved.execution?.skillName ?? null,
					scripts: 0,
				};
			}
			const toolCallDecision = deps.extensions
				? await deps.extensions.emitToolCall({
						runId,
						toolName: "skill_exec",
						commandKind: loaded.command.kind,
						input: {
							skillName: resolved.execution.skillName,
							scripts: resolved.execution.scripts,
						},
					})
				: { blocked: false };
			if (toolCallDecision.blocked) {
				await deps.extensions?.emitToolResult({
					runId,
					toolName: "skill_exec",
					commandKind: loaded.command.kind,
					result: {
						status: "blocked",
						reason: toolCallDecision.reason ?? "blocked by extension",
					},
				});
				return {
					skillName: resolved.execution.skillName,
					scripts: 0,
					blocked: true,
					reason: toolCallDecision.reason ?? "blocked by extension",
				};
			}
			const skillRows = await executeSkillPlanDurably({
				runId,
				commandSeq: loaded.command.seq,
				commandKind: loaded.command.kind,
				plan: resolved.execution,
				deps: {
					artifactService: deps.artifactService,
					runService: deps.runService,
					runScript: createSandboxSkillRunner({
						backend: deps.backend,
						sandbox: loaded.sandbox,
						runId,
						commandSeq: loaded.command.seq,
					}),
				},
				timeoutMs: loaded.sandbox.spec.timeoutSec * 1_000,
				maxBytesOut: loaded.sandbox.spec.maxBytesOut,
			});
			const artifactShas = skillRows.flatMap((row) => row.artifactShas);
			await deps.extensions?.emitToolResult({
				runId,
				toolName: "skill_exec",
				commandKind: loaded.command.kind,
				result: {
					status: "executed",
					skillName: resolved.execution.skillName,
					scripts: resolved.execution.scripts.length,
					details:
						artifactShas.length === 0
							? undefined
							: {
									artifactSha: artifactShas[0],
									artifactShas,
								},
				},
			});
			return {
				skillName: resolved.execution.skillName,
				scripts: resolved.execution.scripts.length,
			};
		});

		startedAt = clockIso();
		await steps.runStep("applyCommand", async () => {
			if (replayPayload) {
				return;
			}
			const loaded = assertLoaded(loadedPlan);
			if (loaded.run.status === "queued" && loaded.command.kind !== "approve") {
				await deps.runService.beginRun(runId, { scope: loaded.run.spec.scope });
				await emitSessionBootstrap({
					extensions: deps.extensions,
					runId,
					sessionId: loaded.run.piSessionId ?? undefined,
				});
			}
			switch (loaded.command.kind) {
				case "approve":
					await deps.sandboxRepo.markApproved(runId);
					await deps.runService.appendRunEvent(runId, "run_approved", {
						seq: loaded.command.seq,
					});
					return;
				case "prompt": {
					const withBeforeStart = deps.extensions
						? await deps.extensions.emitBeforeAgentStart({
								runId,
								commandKind: "prompt",
								text: resolvedSkillText ?? readCommandText(loaded.command),
							})
						: {
								runId,
								commandKind: "prompt" as const,
								text: resolvedSkillText ?? readCommandText(loaded.command),
							};
					const withContext = deps.extensions
						? await deps.extensions.emitContext(withBeforeStart)
						: withBeforeStart;
					const userMsg = withContext.text;
					const promptSpec = {
						...loaded.run.spec,
						userMsg,
					};
					const availableSkillsXml = deps.skills
						? await deps.skills.buildAvailableSkillsXml()
						: undefined;
					const stagedBySha = new Map(
						stagedInputs.map((input) => [input.sha256, input]),
					);
					await (await getOrCreateSession()).prompt(
						await buildRunPromptInput(
							promptSpec,
							{
								getArtifactMeta: async (sha256: string) =>
									deps.artifactService.getArtifactMeta(sha256),
								getArtifactBytes: async (sha256: string) => {
									const staged = stagedBySha.get(sha256);
									if (!staged) {
										return deps.artifactService.getArtifactBytes(sha256);
									}
									const meta =
										await deps.artifactService.getArtifactMeta(sha256);
									return {
										body: createReadStream(staged.hostPath),
										contentType: meta.mime,
									};
								},
							},
							{
								availableSkillsXml,
							},
						),
					);
					return;
				}
				case "followUp": {
					const withContext = deps.extensions
						? await deps.extensions.emitContext({
								runId,
								commandKind: "followUp",
								text: resolvedSkillText ?? readCommandText(loaded.command),
							})
						: {
								runId,
								commandKind: "followUp" as const,
								text: resolvedSkillText ?? readCommandText(loaded.command),
							};
					await (await getOrCreateSession()).followUp(withContext.text);
					return;
				}
				case "steer": {
					const withContext = deps.extensions
						? await deps.extensions.emitContext({
								runId,
								commandKind: "steer",
								text: resolvedSkillText ?? readCommandText(loaded.command),
							})
						: {
								runId,
								commandKind: "steer" as const,
								text: resolvedSkillText ?? readCommandText(loaded.command),
							};
					await (await getOrCreateSession()).steer(withContext.text);
					return;
				}
				case "abort":
					await (await getOrCreateSession()).abort();
					return;
			}
		});

		const collected = await steps.runStep("collect", async () => {
			const loaded = assertLoaded(loadedPlan);
			if (replayPayload) {
				if (loaded.command.kind === "approve") {
					return null;
				}
				return toReplayCollected(loaded.run, loaded.sandbox, replayPayload);
			}
			if (loaded.command.kind === "approve") {
				return null;
			}
			const activeSession = await getOrCreateSession();
			await activeSession.waitUntilIdle({
				onEvent: async (event) => {
					await deps.runService.appendPiEvent(runId, event);
				},
			});
			const sessionState = await activeSession.getState();
			const sessionBytes = await readFileBytes(sessionState.sessionFile);
			const parsedSession = parseSessionJsonl(sessionBytes.toString("utf8"));
			assertToolCallResultAdjacency(parsedSession.entries);
			const sessionArtifact = await deps.artifactService.putArtifact({
				body: sessionBytes,
				mime: "application/jsonl",
				type: "trace",
				meta: {
					"run.id": runId,
					"pi.session": sessionState.sessionId,
				},
			});
			await deps.runService.linkArtifact(
				runId,
				sessionArtifact.sha256,
				"pi_session_jsonl",
			);
			await deps.runService.appendArtifactWritten(runId, {
				sha256: sessionArtifact.sha256,
				kind: "pi_session_jsonl",
			});
			const execResult = await deps.backend.exec(loaded.sandbox, {
				cmd: toSessionTailCommand(
					toSandboxSessionPath(runId, loaded.sandbox),
					loaded.sandbox.spec.maxBytesOut,
				),
				cwd: loaded.sandbox.spec.workdir,
				stream: false,
				timeoutSec: loaded.sandbox.spec.timeoutSec,
				maxBytesOut: loaded.sandbox.spec.maxBytesOut,
			});
			const withRefs: ExecResult = { ...execResult };
			if (withRefs.stdoutTail.length > 0) {
				const stdoutArtifact = await deps.artifactService.putArtifact({
					body: Buffer.from(withRefs.stdoutTail, "utf8"),
					mime: "text/plain",
					type: "trace",
					meta: {
						"run.id": runId,
						"run.command.seq": String(loaded.command.seq),
						"run.exec.stream": "stdout",
					},
				});
				withRefs.stdoutRef = { sha256: stdoutArtifact.sha256 };
				await deps.runService.linkArtifact(
					runId,
					stdoutArtifact.sha256,
					"sandbox_stdout",
				);
				await deps.runService.appendArtifactWritten(runId, {
					sha256: stdoutArtifact.sha256,
					kind: "sandbox_stdout",
				});
			}
			if (withRefs.stderrTail.length > 0) {
				const stderrArtifact = await deps.artifactService.putArtifact({
					body: Buffer.from(withRefs.stderrTail, "utf8"),
					mime: "text/plain",
					type: "trace",
					meta: {
						"run.id": runId,
						"run.command.seq": String(loaded.command.seq),
						"run.exec.stream": "stderr",
					},
				});
				withRefs.stderrRef = { sha256: stderrArtifact.sha256 };
				await deps.runService.linkArtifact(
					runId,
					stderrArtifact.sha256,
					"sandbox_stderr",
				);
				await deps.runService.appendArtifactWritten(runId, {
					sha256: stderrArtifact.sha256,
					kind: "sandbox_stderr",
				});
			}
			withRefs.cmdList = toCommandList(loaded.command);
			withRefs.artifactReads = toArtifactReads(loaded.run);
			withRefs.artifactWrites = withPointer(
				withPointer([{ sha256: sessionArtifact.sha256 }], withRefs.stdoutRef),
				withRefs.stderrRef,
			);
			return {
				resultText: normalizeResultText(
					await activeSession.getLastAssistantText(),
				),
				stats: await activeSession.getSessionStats(),
				sessionState,
				sessionEntryIds:
					parsedSession.leafPathIds.length > 0
						? parsedSession.leafPathIds
						: [sessionState.sessionId],
				sessionIndex: {
					entryCount: parsedSession.entryCount,
					rootId: parsedSession.rootId,
					leafId: parsedSession.leafId,
					summaryEntryCount: parsedSession.summaryEntryCount,
				},
				sessionArtifactSha: sessionArtifact.sha256,
				execResult: withRefs,
			} satisfies Omit<CollectedCommand, "workspaceRef">;
		});

		const withSnapshot = await steps.runStep("snapshot", async () => {
			if (!collected) {
				return null;
			}
			if (replayPayload) {
				return {
					...collected,
					workspaceRef: collected.workspaceRef,
				} satisfies CollectedCommand;
			}
			const workspaceRef = await deps.backend.snapshot(
				assertLoaded(loadedPlan).sandbox,
				WORKSPACE_SNAPSHOT_RULE,
			);
			await deps.runService.linkArtifact(
				runId,
				workspaceRef.sha256,
				"workspace_snapshot",
			);
			await deps.runService.appendArtifactWritten(runId, {
				sha256: workspaceRef.sha256,
				kind: "workspace_snapshot",
			});
			await deps.runService.appendRunEvent(runId, "workspace_updated", {
				workspaceRef,
			});
			return {
				...collected,
				workspaceRef,
			} satisfies CollectedCommand;
		});

		await steps.runStep("release", async () => {
			const loaded = assertLoaded(loadedPlan);
			const endedAt = clockIso();
			const baseResult: ExecResult = withSnapshot
				? {
						...withSnapshot.execResult,
						exitCode:
							loaded.command.kind === "abort"
								? 137
								: withSnapshot.execResult.exitCode,
						status:
							loaded.command.kind === "abort"
								? "aborted"
								: withSnapshot.execResult.status,
						timeoutSec: loaded.sandbox.spec.timeoutSec,
						maxBytesOut: loaded.sandbox.spec.maxBytesOut,
						startedAt: startedAt ?? withSnapshot.execResult.startedAt,
						endedAt,
						workspaceRef: withSnapshot.workspaceRef,
					}
				: {
						exitCode: loaded.command.kind === "abort" ? 137 : 0,
						status: loaded.command.kind === "abort" ? "aborted" : "done",
						cmdList: toCommandList(loaded.command),
						artifactReads: toArtifactReads(loaded.run),
						artifactWrites: [],
						stdoutTail: "",
						stderrTail: "",
						stdoutBytes: 0,
						stderrBytes: 0,
						timeoutSec: loaded.sandbox.spec.timeoutSec,
						maxBytesOut: loaded.sandbox.spec.maxBytesOut,
						startedAt: startedAt ?? endedAt,
						endedAt,
						workspaceRef: undefined,
					};
			if (withSnapshot?.workspaceRef) {
				baseResult.artifactWrites = withPointer(
					baseResult.artifactWrites ?? [],
					withSnapshot.workspaceRef,
				);
			}
			if (!replayPayload) {
				const persisted = await deps.sandboxRepo.persistExec({
					runId,
					workflowId,
					commandSeq: loaded.command.seq,
					commandKind: loaded.command.kind,
					result: baseResult,
					workspaceRef: withSnapshot?.workspaceRef,
				});
				nextPendingSeq = persisted.nextPendingSeq;
			}
			const stepName = replayPayload
				? replay.mode === "debug"
					? "replay_debug_run_command"
					: "replay_stub_run_command"
				: "run_command";
			const attempt = loaded.command.seq;
			const { stepKey, inHash, outHash } = buildStepHashes({
				runId,
				stepName,
				attempt,
				command: loaded.command,
				exec: baseResult,
				sessionEntryIds: withSnapshot?.sessionEntryIds ?? [],
			});
			await deps.runService.recordStepLedger({
				runId,
				stepName,
				attempt,
				stepKey,
				inHash,
				outHash,
				startedAt: baseResult.startedAt,
				endedAt: baseResult.endedAt,
				sessionEntryIds: withSnapshot?.sessionEntryIds ?? [],
				artifactShas: toLedgerArtifactShas(baseResult),
				note: `step=${stepName} kind=${loaded.command.kind} status=${baseResult.status}`,
				payload: replayPayload
					? {
							replayMode: replay.mode,
							replaySourceRunId: replayPayload.runId,
							synthetic: true,
							out_payload: replayPayload,
						}
					: {
							commandSeq: loaded.command.seq,
							commandKind: loaded.command.kind,
							commandPayload: loaded.command.payload,
							exec: {
								exitCode: baseResult.exitCode,
								status: baseResult.status,
								startedAt: baseResult.startedAt,
								endedAt: baseResult.endedAt,
								cmdList: baseResult.cmdList,
								artifactReads: baseResult.artifactReads,
								artifactWrites: baseResult.artifactWrites,
							},
							session: withSnapshot
								? {
										sessionId: withSnapshot.sessionState.sessionId,
										sessionFile: withSnapshot.sessionState.sessionFile,
										sessionArtifactSha: withSnapshot.sessionArtifactSha,
										sessionEntryIds: withSnapshot.sessionEntryIds,
										entryCount: withSnapshot.sessionIndex.entryCount,
										rootId: withSnapshot.sessionIndex.rootId,
										leafId: withSnapshot.sessionIndex.leafId,
										summaryEntryCount:
											withSnapshot.sessionIndex.summaryEntryCount,
									}
								: null,
						},
				sessionIndex: withSnapshot?.sessionIndex,
			});
			if (!replayPayload && loaded.command.kind === "abort") {
				await deps.runService.appendRunEvent(runId, "run_aborted", {
					seq: loaded.command.seq,
				});
				await deps.runService.failRun(runId, new Error("aborted by user"));
			}
			await closeSession(session);
			session = null;
			if (!replayPayload) {
				await deps.sandboxRepo.releaseLease(runId, workflowId);
			}
			if (nextPendingSeq != null) {
				nextWorkflowId = toRunSandboxWorkflowId(runId, nextPendingSeq);
			}
		});
		if (nextWorkflowId) {
			await deps.workflowLauncher.startRunOnce(runId, {
				workflowID: nextWorkflowId,
			});
		}
	} catch (error) {
		let retryWorkflowId: string | null = null;
		await steps.runStep("markFailed", async () => {
			if (loadedPlan) {
				if (!replayPayload && !isClaimOrLeaseLost(error)) {
					const command = loadedPlan.command;
					const errorMessage = normalizeErrorMessage(error);
					const transient = error instanceof RunTransientError;
					nextPendingSeq = transient
						? await deps.sandboxRepo.requeueCommand({
								runId,
								workflowId,
								commandSeq: command.seq,
								error: errorMessage,
							})
						: await deps.sandboxRepo.markCommandDead({
								runId,
								workflowId,
								commandSeq: command.seq,
								error: errorMessage,
							});
					await deps.runService.recordStepLedger(
						buildFailedCommandLedger({
							run: loadedPlan.run,
							sandbox: loadedPlan.sandbox,
							command,
							runId,
							startedAt: startedAt ?? undefined,
							errorMessage,
							transient,
						}),
					);
					if (!transient) {
						await deps.runService.failRun(runId, error);
					}
					if (nextPendingSeq != null && transient) {
						retryWorkflowId = toRunSandboxWorkflowId(runId, nextPendingSeq);
					}
				}
				if (!replayPayload) {
					await deps.sandboxRepo.releaseLease(runId, workflowId);
				}
			}
			await closeSession(session);
			session = null;
		});
		if (retryWorkflowId) {
			await deps.workflowLauncher.startRunOnce(runId, {
				workflowID: retryWorkflowId,
			});
		}
		throw error;
	}
}

let activeDeps: RunSandboxDeps | null = null;
let registeredWorkflow: RegisteredRunWorkflow | null = null;

export function registerRunSandboxWorkflow(
	deps: RunSandboxDeps,
): RegisteredRunWorkflow {
	activeDeps = deps;
	if (!registeredWorkflow) {
		registeredWorkflow = DBOS.registerWorkflow(
			async (runId: string): Promise<void> => {
				const currentDeps = activeDeps;
				if (!currentDeps) {
					throw new Error("RunSandbox deps are not registered");
				}
				await executeRunSandbox(runId, currentDeps, dbosStepRunner);
			},
			{
				name: "forkloomRunSandbox",
			},
		);
	}
	return registeredWorkflow;
}
