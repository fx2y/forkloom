import { readFile } from "node:fs/promises";
import { DBOS } from "@dbos-inc/dbos-sdk";
import type { PiSessionPort, PiSessionState, PiSessionStats } from "../pi";
import type { RunModel, RunRepo } from "../run/ports";
import type { RegisteredRunWorkflow, RunService } from "../run/service";
import type { ArtifactService } from "../service";
import { buildRunPromptInput } from "./prompt";
import {
	buildGenericStepHashes,
	buildGenericStepPayload,
} from "./step-hash";

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
		| "recordStepLedger"
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

function normalizeResultText(value: string): string {
	const trimmed = value.trim();
	return trimmed.length > 0 ? value : "[no assistant text]";
}

function clockIso(): string {
	return new globalThis.Date().toISOString();
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

	const getOrCreateSession = async (): Promise<PiSessionPort> => {
		if (!ctx.pi) {
			ctx.pi = await deps.createPiSession(assertRun(ctx));
		}
		return ctx.pi;
	};

	const runLedgerStep = async <T>(
		name: RunCoreStepName | "markFailed",
		stepInput: unknown,
		fn: () => Promise<T>,
		opts?: {
			attempt?: number | undefined;
			note?: string | undefined;
			resolveMetadata?:
				| ((
						out: T,
				  ) => {
						sessionEntryIds?: string[] | undefined;
						artifactShas?: string[] | undefined;
				  })
				| undefined;
		},
	): Promise<T> =>
		steps.runStep(name, async () => {
			const startedAt = clockIso();
			const out = await fn();
			const endedAt = clockIso();
			const attempt = opts?.attempt ?? 1;
			const { stepKey, inHash, outHash } = buildGenericStepHashes({
				runId,
				stepName: name,
				attempt,
				stepInput,
				stepOutput: out,
			});
			const metadata = opts?.resolveMetadata?.(out);
			await deps.runService.recordStepLedger({
				runId,
				stepName: name,
				attempt,
				stepKey,
				inHash,
				outHash,
				startedAt,
				endedAt,
				sessionEntryIds: metadata?.sessionEntryIds ?? [],
				artifactShas: metadata?.artifactShas ?? [],
				note: opts?.note ?? `step=${name}`,
				payload: buildGenericStepPayload({
					stepInput,
					stepOutput: out,
				}),
			});
			return out;
		});

	try {
		ctx.run = await runLedgerStep(
			"initRun",
			{ runId },
			async () => {
				const run = await deps.runRepo.getRun(runId);
				if (!run) {
					throw new Error(`run not found: ${runId}`);
				}
				await deps.runService.beginRun(runId, { scope: run.spec.scope });
				return run;
			},
		);

		ctx.artifactShas = await runLedgerStep(
			"stageInputs",
			{
				attachments: assertRun(ctx).spec.attachments.map((pointer) => pointer.sha256),
			},
			async () => {
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
			},
			{
				resolveMetadata: () => ({
					artifactShas: assertRun(ctx).spec.attachments.map(
						(pointer) => pointer.sha256,
					),
				}),
			},
		);

		await runLedgerStep("startPi", { runId }, async () => undefined, {
			resolveMetadata: () => ({ artifactShas: [...ctx.artifactShas] }),
		});

		await runLedgerStep(
			"promptPi",
			{
				userMsg: assertRun(ctx).spec.userMsg,
				attachments: assertRun(ctx).spec.attachments.map(
					(pointer) => pointer.sha256,
				),
				modelPref: assertRun(ctx).spec.modelPref ?? null,
			},
			async () => {
				const run = assertRun(ctx);
				const session = await getOrCreateSession();
				await session.prompt(
					await buildRunPromptInput(run.spec, deps.artifactService),
				);
				return { prompted: true };
			},
			{
				resolveMetadata: () => ({ artifactShas: [...ctx.artifactShas] }),
			},
		);

		await runLedgerStep(
			"pumpEvents",
			{ runId },
			async () => {
				const session = await getOrCreateSession();
				await session.waitUntilIdle({
					onEvent: async (event) => {
						await deps.runService.appendPiEvent(runId, event);
					},
				});
				return { drained: true };
			},
			{
				resolveMetadata: () => ({ artifactShas: [...ctx.artifactShas] }),
			},
		);

		const finalized = await runLedgerStep(
			"finalize",
			{ runId },
			async () => {
				const session = await getOrCreateSession();
				return {
					state: await session.getState(),
					resultText: normalizeResultText(await session.getLastAssistantText()),
					stats: await session.getSessionStats(),
				};
			},
			{
				resolveMetadata: () => ({ artifactShas: [...ctx.artifactShas] }),
			},
		);
		ctx.state = finalized.state;
		ctx.resultText = finalized.resultText;
		ctx.stats = finalized.stats;

		const persistedSession = await runLedgerStep(
			"persistSession",
			{
				sessionId: assertState(ctx).sessionId,
				sessionFile: assertState(ctx).sessionFile,
			},
			async () => {
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
			},
			{
				resolveMetadata: (out) => ({
					sessionEntryIds: [assertState(ctx).sessionId],
					artifactShas: [...ctx.artifactShas, out.sha256],
				}),
			},
		);
		ctx.sessionArtifactSha = persistedSession.sha256;
		ctx.sessionArtifactUri = persistedSession.uri;
		if (!ctx.artifactShas.includes(persistedSession.sha256)) {
			ctx.artifactShas.push(persistedSession.sha256);
		}

		await runLedgerStep(
			"markDone",
			{
				resultText: assertText(ctx),
				stats: assertStats(ctx),
				artifacts: [...ctx.artifactShas],
			},
			async () => {
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
				return { marked: "done" as const };
			},
			{
				resolveMetadata: () => ({
					sessionEntryIds: [assertState(ctx).sessionId],
					artifactShas: [...ctx.artifactShas],
				}),
			},
		);
	} catch (error) {
		await runLedgerStep(
			"markFailed",
			{
				error:
					error instanceof Error && error.message.length > 0
						? error.message
						: String(error),
			},
			async () => {
				await deps.runService.failRun(runId, error);
				await closePi(ctx);
				return { marked: "failed" as const };
			},
			{
				note: "step=markFailed",
				resolveMetadata: () => ({
					sessionEntryIds: ctx.state ? [ctx.state.sessionId] : [],
					artifactShas: [...ctx.artifactShas],
				}),
			},
		);
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
