import { readFile } from "node:fs/promises";
import { DBOS } from "@dbos-inc/dbos-sdk";
import type { PiSessionPort, PiSessionState, PiSessionStats } from "../pi";
import type { RunModel, RunRepo } from "../run/ports";
import type { RegisteredRunWorkflow, RunService } from "../run/service";
import { WORKSPACE_SNAPSHOT_RULE, materializeSandboxInputs } from "../sandbox";
import type {
	RunCommandModel,
	RunnerBackend,
	SandboxModel,
	SandboxRepo,
} from "../sandbox";
import type { ArtifactService } from "../service";
import { buildRunPromptInput } from "./prompt";

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
	sessionArtifactSha: string;
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
				sandbox.spec.mounts.find((mount) => mount.kind === "inputs")?.source ??
				sandbox.spec.piHomeHostDir;
			await materializeSandboxInputs({
				runId,
				attachments: assertLoaded(loadedPlan).run.spec.attachments,
				inputRoot: inputMount,
				artifactService: deps.artifactService,
			});
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
					await (await getOrCreateSession()).prompt(
						await buildRunPromptInput(promptSpec, deps.artifactService),
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
			return {
				resultText: normalizeResultText(
					await activeSession.getLastAssistantText(),
				),
				stats: await activeSession.getSessionStats(),
				sessionState,
				sessionArtifactSha: sessionArtifact.sha256,
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
			const baseResult = {
				exitCode: loaded.command.kind === "abort" ? 137 : 0,
				status: loaded.command.kind === "abort" ? "aborted" : "done",
				stdoutTail: "",
				stderrTail: "",
				stdoutBytes: 0,
				stderrBytes: 0,
				timeoutSec: loaded.sandbox.spec.timeoutSec,
				maxBytesOut: loaded.sandbox.spec.maxBytesOut,
				startedAt: startedAt ?? endedAt,
				endedAt,
				workspaceRef: withSnapshot?.workspaceRef,
			} as const;
			const persisted = await deps.sandboxRepo.persistExec({
				runId,
				workflowId,
				commandSeq: loaded.command.seq,
				commandKind: loaded.command.kind,
				result: baseResult,
				workspaceRef: withSnapshot?.workspaceRef,
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
				await deps.workflowLauncher.startRunOnce(runId, {
					workflowID: toRunSandboxWorkflowId(runId, nextPendingSeq),
				});
			}
		});
	} catch (error) {
		await steps.runStep("markFailed", async () => {
			if (loadedPlan) {
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
				await deps.sandboxRepo.releaseLease(runId, workflowId);
				if (nextPendingSeq != null && error instanceof RunTransientError) {
					await deps.workflowLauncher.startRunOnce(runId, {
						workflowID: toRunSandboxWorkflowId(runId, nextPendingSeq),
					});
				}
			}
			await closeSession(session);
			session = null;
		});
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
