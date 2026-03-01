import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { DBOS } from "@dbos-inc/dbos-sdk";
import {
	type PiSessionPort,
	type PiSessionState,
	type PiSessionStats,
	assertToolCallResultAdjacency,
	parseSessionJsonl,
} from "../pi";
import type { RunModel, RunRepo } from "../run/ports";
import type { RegisteredRunWorkflow, RunService } from "../run/service";
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
import { buildRunPromptInput } from "./prompt";
import { buildStepHashes } from "./step-hash";

type RunSandboxStepName =
	| "loadPlan"
	| "ensureSandbox"
	| "stageInputs"
	| "ensurePi"
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
	runRepo: Pick<RunRepo, "getRun">;
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
	let loadedPlan: LoadedPlan | null = null;
	let session: PiSessionPort | null = null;
	let startedAt: string | null = null;
	let nextPendingSeq: number | null = null;
	let nextWorkflowId: string | null = null;
	let stagedInputs: StagedSandboxInput[] = [];

	const getOrCreateSession = async (): Promise<PiSessionPort> => {
		if (!session) {
			session = await deps.createPiSession(
				assertLoaded(loadedPlan).run,
				assertLoaded(loadedPlan).sandbox,
			);
		}
		return session;
	};

	try {
		loadedPlan = await steps.runStep("loadPlan", async () => {
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

		const liveSandbox = await steps.runStep("ensureSandbox", async () =>
			deps.backend.ensure(activePlan.sandbox.spec),
		);
		loadedPlan = { ...loadedPlan, sandbox: liveSandbox };

		await steps.runStep("stageInputs", async () => {
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

		startedAt = clockIso();
		await steps.runStep("applyCommand", async () => {
			const loaded = assertLoaded(loadedPlan);
			if (loaded.run.status === "queued" && loaded.command.kind !== "approve") {
				await deps.runService.beginRun(runId, { scope: loaded.run.spec.scope });
			}
			switch (loaded.command.kind) {
				case "approve":
					await deps.sandboxRepo.markApproved(runId);
					await deps.runService.appendRunEvent(runId, "run_approved", {
						seq: loaded.command.seq,
					});
					return;
				case "prompt": {
					const promptSpec = {
						...loaded.run.spec,
						userMsg: readCommandText(loaded.command),
					};
					const stagedBySha = new Map(
						stagedInputs.map((input) => [input.sha256, input]),
					);
					await (await getOrCreateSession()).prompt(
						await buildRunPromptInput(promptSpec, {
							getArtifactMeta: async (sha256: string) =>
								deps.artifactService.getArtifactMeta(sha256),
							getArtifactBytes: async (sha256: string) => {
								const staged = stagedBySha.get(sha256);
								if (!staged) {
									return deps.artifactService.getArtifactBytes(sha256);
								}
								const meta = await deps.artifactService.getArtifactMeta(sha256);
								return {
									body: createReadStream(staged.hostPath),
									contentType: meta.mime,
								};
							},
						}),
					);
					return;
				}
				case "followUp":
					await (await getOrCreateSession()).followUp(
						readCommandText(loaded.command),
					);
					return;
				case "steer":
					await (await getOrCreateSession()).steer(
						readCommandText(loaded.command),
					);
					return;
				case "abort":
					await (await getOrCreateSession()).abort();
					return;
			}
		});

		const collected = await steps.runStep("collect", async () => {
			const loaded = assertLoaded(loadedPlan);
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
			const persisted = await deps.sandboxRepo.persistExec({
				runId,
				workflowId,
				commandSeq: loaded.command.seq,
				commandKind: loaded.command.kind,
				result: baseResult,
				workspaceRef: withSnapshot?.workspaceRef,
			});
			const stepName = "run_command";
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
				payload: {
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
								summaryEntryCount: withSnapshot.sessionIndex.summaryEntryCount,
							}
						: null,
				},
				sessionIndex: withSnapshot?.sessionIndex,
			});
			nextPendingSeq = persisted.nextPendingSeq;
			if (loaded.command.kind === "abort") {
				await deps.runService.appendRunEvent(runId, "run_aborted", {
					seq: loaded.command.seq,
				});
				await deps.runService.failRun(runId, new Error("aborted by user"));
			}
			await closeSession(session);
			session = null;
			await deps.sandboxRepo.releaseLease(runId, workflowId);
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
				if (!isClaimOrLeaseLost(error)) {
					const command = loadedPlan.command;
					nextPendingSeq =
						error instanceof RunTransientError
							? await deps.sandboxRepo.requeueCommand({
									runId,
									workflowId,
									commandSeq: command.seq,
									error: normalizeErrorMessage(error),
								})
							: await deps.sandboxRepo.markCommandDead({
									runId,
									workflowId,
									commandSeq: command.seq,
									error: normalizeErrorMessage(error),
								});
					if (!(error instanceof RunTransientError)) {
						await deps.runService.failRun(runId, error);
					}
					if (nextPendingSeq != null && error instanceof RunTransientError) {
						retryWorkflowId = toRunSandboxWorkflowId(runId, nextPendingSeq);
					}
				}
				await deps.sandboxRepo.releaseLease(runId, workflowId);
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
