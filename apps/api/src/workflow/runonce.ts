import { readFile } from "node:fs/promises";
import { DBOS } from "@dbos-inc/dbos-sdk";
import type { PiSessionPort, PiSessionState, PiSessionStats } from "../pi";
import type { RunModel, RunRepo } from "../run/ports";
import type { RegisteredRunWorkflow, RunService } from "../run/service";
import type { ArtifactService } from "../service";
import { buildRunPromptInput } from "./prompt";

type RunCoreStepName =
	| "initRun"
	| "stageInputs"
	| "startPi"
	| "promptPi"
	| "pumpEvents"
	| "finalize"
	| "persistSession"
	| "markDone";

type RunOnceStepRunner = {
	runStep<T>(
		name: RunCoreStepName | "markFailed",
		fn: () => Promise<T>,
	): Promise<T>;
};

type RunOnceContext = {
	run: RunModel | null;
	pi: PiSessionPort | null;
	state: PiSessionState | null;
	resultText: string | null;
	stats: PiSessionStats | null;
	sessionArtifactSha: string | null;
	sessionArtifactUri: string | null;
	artifactShas: string[];
};

export type RunOnceDeps = {
	runRepo: Pick<RunRepo, "getRun">;
	runService: Pick<
		RunService,
		| "appendArtifactWritten"
		| "appendPiEvent"
		| "beginRun"
		| "completeRun"
		| "failRun"
		| "linkArtifact"
	>;
	artifactService: Pick<
		ArtifactService,
		"getArtifactBytes" | "getArtifactMeta" | "putArtifact"
	>;
	createPiSession(run: RunModel): Promise<PiSessionPort>;
	readFileBytes?: ((path: string) => Promise<Buffer>) | undefined;
};

const dbosStepRunner: RunOnceStepRunner = {
	runStep<T>(
		name: RunCoreStepName | "markFailed",
		fn: () => Promise<T>,
	): Promise<T> {
		return DBOS.runStep(fn, { name });
	},
};

function assertRun(ctx: RunOnceContext): RunModel {
	if (!ctx.run) {
		throw new Error("run context is not initialized");
	}
	return ctx.run;
}

function assertSession(ctx: RunOnceContext): PiSessionPort {
	if (!ctx.pi) {
		throw new Error("pi session is not initialized");
	}
	return ctx.pi;
}

function assertState(ctx: RunOnceContext): PiSessionState {
	if (!ctx.state) {
		throw new Error("pi state is not initialized");
	}
	return ctx.state;
}

function assertText(ctx: RunOnceContext): string {
	if (ctx.resultText === null) {
		throw new Error("result text is missing");
	}
	return ctx.resultText;
}

function assertStats(ctx: RunOnceContext): PiSessionStats {
	if (!ctx.stats) {
		throw new Error("result stats are missing");
	}
	return ctx.stats;
}

function assertSessionArtifactUri(ctx: RunOnceContext): string {
	if (!ctx.sessionArtifactUri) {
		throw new Error("session artifact uri is missing");
	}
	return ctx.sessionArtifactUri;
}

function normalizeUnknownRecord(
	input: Record<string, unknown>,
): Record<string, unknown> {
	return input;
}

async function closePi(ctx: RunOnceContext): Promise<void> {
	if (!ctx.pi) {
		return;
	}
	await ctx.pi.close();
	ctx.pi = null;
}

export async function executeRunOnce(
	runId: string,
	deps: RunOnceDeps,
	steps: RunOnceStepRunner = dbosStepRunner,
): Promise<void> {
	const readFileBytes = deps.readFileBytes ?? readFile;
	const ctx: RunOnceContext = {
		run: null,
		pi: null,
		state: null,
		resultText: null,
		stats: null,
		sessionArtifactSha: null,
		sessionArtifactUri: null,
		artifactShas: [],
	};

	try {
		ctx.run = await steps.runStep("initRun", async () => {
			const run = await deps.runRepo.getRun(runId);
			if (!run) {
				throw new Error(`run not found: ${runId}`);
			}
			await deps.runService.beginRun(runId, { scope: run.spec.scope });
			return run;
		});

		ctx.artifactShas = await steps.runStep("stageInputs", async () => {
			const run = assertRun(ctx);
			const artifactShas: string[] = [];
			for (const pointer of run.spec.attachments) {
				await deps.runService.linkArtifact(
					runId,
					pointer.sha256,
					"input_attachment",
				);
				await deps.runService.appendArtifactWritten(runId, {
					sha256: pointer.sha256,
					kind: "input_attachment",
				});
				artifactShas.push(pointer.sha256);
			}
			return artifactShas;
		});

		await steps.runStep("startPi", async () => {
			const run = assertRun(ctx);
			ctx.pi = await deps.createPiSession(run);
		});

		await steps.runStep("promptPi", async () => {
			const run = assertRun(ctx);
			const session = assertSession(ctx);
			await session.prompt(
				await buildRunPromptInput(run.spec, deps.artifactService),
			);
		});

		await steps.runStep("pumpEvents", async () => {
			const session = assertSession(ctx);
			await session.waitUntilIdle({
				onEvent: async (event) => {
					await deps.runService.appendPiEvent(
						runId,
						normalizeUnknownRecord(event),
					);
				},
			});
		});

		const finalized = await steps.runStep("finalize", async () => {
			const session = assertSession(ctx);
			return {
				state: await session.getState(),
				resultText: await session.getLastAssistantText(),
				stats: await session.getSessionStats(),
			};
		});
		ctx.state = finalized.state;
		ctx.resultText = finalized.resultText;
		ctx.stats = finalized.stats;

		const persistedSession = await steps.runStep("persistSession", async () => {
			const state = assertState(ctx);
			const bytes = await readFileBytes(state.sessionFile);
			const artifact = await deps.artifactService.putArtifact({
				body: bytes,
				mime: "application/jsonl",
				type: "trace",
				meta: {
					"run.id": runId,
					"pi.session": state.sessionId,
				},
			});
			await deps.runService.linkArtifact(
				runId,
				artifact.sha256,
				"pi_session_jsonl",
			);
			await deps.runService.appendArtifactWritten(runId, {
				sha256: artifact.sha256,
				kind: "pi_session_jsonl",
			});
			return {
				sha256: artifact.sha256,
				uri: artifact.uri,
			};
		});
		ctx.sessionArtifactSha = persistedSession.sha256;
		ctx.sessionArtifactUri = persistedSession.uri;
		if (!ctx.artifactShas.includes(persistedSession.sha256)) {
			ctx.artifactShas.push(persistedSession.sha256);
		}

		await steps.runStep("markDone", async () => {
			const state = assertState(ctx);
			const resultText = assertText(ctx);
			const stats = assertStats(ctx);
			const sessionArtifactUri = assertSessionArtifactUri(ctx);
			await deps.runService.completeRun(runId, {
				resultText,
				stats,
				artifacts: [...ctx.artifactShas],
				piSessionId: state.sessionId,
				piSessionFile: sessionArtifactUri,
			});
			await closePi(ctx);
		});
	} catch (error) {
		await steps.runStep("markFailed", async () => {
			await deps.runService.failRun(runId, error);
			await closePi(ctx);
		});
		throw error;
	}
}

let activeDeps: RunOnceDeps | null = null;
let registeredWorkflow: RegisteredRunWorkflow | null = null;

export function registerRunOnceWorkflow(
	deps: RunOnceDeps,
): RegisteredRunWorkflow {
	activeDeps = deps;
	if (!registeredWorkflow) {
		registeredWorkflow = DBOS.registerWorkflow(
			async (runId: string): Promise<void> => {
				const currentDeps = activeDeps;
				if (!currentDeps) {
					throw new Error("RunOnce deps are not registered");
				}
				await executeRunOnce(runId, currentDeps, dbosStepRunner);
			},
			{
				name: "forkloomRunOnce",
			},
		);
	}
	return registeredWorkflow;
}
