import { DBOS } from "@dbos-inc/dbos-sdk";
import { validateRunByName } from "@forkloom/contracts";
import type {
	RunDocResolve,
	RunDocSearch,
	RunDonePayload,
	RunEvent,
	RunFailedPayload,
	RunState,
	SpanRef,
	TruthBundle as TruthBundleContract,
} from "@forkloom/contracts";
import { HttpError } from "../errors";
import {
	type RunCommandKind,
	type RunCommandModel,
	type SandboxModel,
	type SandboxRepo,
	exportWorkspaceFiles,
	listWorkspaceFiles,
} from "../sandbox";
import type { ArtifactService } from "../service";
import type {
	SkillActivationKind,
	SkillIndexEntry,
	SkillPreview,
	SkillPreviewRequest,
} from "../skill";
import { parseSkillInvocation } from "../skill";
import type {
	PromoteMemberToWsInput,
	PromoteMemberToWsOutput,
	PromoteWsToOrgInput,
	PromoteWsToOrgOutput,
} from "../workflow";
import { toRunSandboxWorkflowId } from "../workflow/run-sandbox";
import type { RunEventKind, RunEventPayloadMap } from "./event";
import type { RunPlan } from "./plan";
import type {
	RecordStepLedgerInput,
	RunEventModel,
	RunModel,
	RunRepo,
	RunSpecModel,
	RunStatus,
	TenantScopeContext,
} from "./ports";
import { toRunEventContract, toRunStateContract } from "./projection";

export type CompleteRunInput = {
	resultText: string;
	stats: Record<string, unknown>;
	artifacts: string[];
	piSessionId: string;
	piSessionFile: string;
};

export type RunStepLedgerInput = RecordStepLedgerInput;

export interface RunWorkflowLauncher {
	startRunOnce(
		input: { runId: string; scope: TenantScopeContext } | string,
		opts: { workflowID: string },
	): Promise<void>;
}

export type RegisteredRunWorkflow = (input: {
	runId: string;
	scope: TenantScopeContext;
}) => Promise<void>;
const SANDBOX_WORKFLOW_ID_PREFIX = "run:";

export class DbosRunWorkflowLauncher implements RunWorkflowLauncher {
	constructor(private readonly workflow: RegisteredRunWorkflow) {}

	async startRunOnce(
		input: { runId: string; scope: TenantScopeContext } | string,
		opts: { workflowID: string },
	): Promise<void> {
		if (typeof input === "string") {
			throw new Error("tenant scope is required for run workflow launch");
		}
		await DBOS.startWorkflow(this.workflow, opts)(input);
	}
}

/**
 * Late-bound launcher that breaks the RunService↔workflow circular dep.
 * Bind classic + sandbox workflows after both are registered.
 */
export class LazyDbosRunWorkflowLauncher implements RunWorkflowLauncher {
	private classic: RunWorkflowLauncher | null = null;
	private sandbox: RunWorkflowLauncher | null = null;

	bindClassic(workflow: RegisteredRunWorkflow): void {
		this.classic = new DbosRunWorkflowLauncher(workflow);
	}

	bindSandbox(workflow: RegisteredRunWorkflow): void {
		this.sandbox = new DbosRunWorkflowLauncher(workflow);
	}

	async startRunOnce(
		input: { runId: string; scope: TenantScopeContext } | string,
		opts: { workflowID: string },
	): Promise<void> {
		const target = opts.workflowID.startsWith(SANDBOX_WORKFLOW_ID_PREFIX)
			? this.sandbox
			: this.classic;
		if (!target) {
			throw new Error(
				opts.workflowID.startsWith(SANDBOX_WORKFLOW_ID_PREFIX)
					? "Run sandbox workflow is not registered"
					: "Run workflow is not registered",
			);
		}
		return target.startRunOnce(input, opts);
	}
}

type SandboxDeps = {
	sandboxRepo: Pick<
		SandboxRepo,
		| "createSandbox"
		| "getSandbox"
		| "getCurrentCommand"
		| "listExecs"
		| "markApproved"
		| "queueCommand"
	>;
	createRunPlan(spec: RunSpecModel): RunPlan;
	artifactService: Pick<
		ArtifactService,
		"getArtifactBytes" | "getArtifactMeta" | "putArtifact"
	>;
};

type RunDocDeps = {
	searchDocs(input: {
		query: string;
		scope: string;
		limit?: number | undefined;
	}): Promise<RunDocSearch>;
	resolveSpan(span: SpanRef): Promise<RunDocResolve | null>;
	ingestDoc(input: {
		body: Buffer;
		mime: string;
	}): Promise<{
		docSha: string;
		parseId: string;
		status: "queued" | "rejected" | "deduped";
		reason?: string | undefined;
	}>;
};

type RunSkillDeps = {
	listSkills(): Promise<SkillIndexEntry[]>;
	hasSkill(skillName: string): Promise<boolean>;
	resolvePromptText(input: {
		text: string;
		activationKind?: SkillActivationKind | undefined;
	}): Promise<string>;
	previewSkill(input: SkillPreviewRequest): Promise<SkillPreview | null>;
};

type RunPromotionDeps = {
	promoteMemberToWs(input: PromoteMemberToWsInput): Promise<PromoteMemberToWsOutput>;
	promoteWsToOrg(input: PromoteWsToOrgInput): Promise<PromoteWsToOrgOutput>;
};

export type RunServiceDeps = {
	runRepo: RunRepo;
	workflowLauncher: RunWorkflowLauncher;
	sandbox?: SandboxDeps | undefined;
	docs?: RunDocDeps | undefined;
	skills?: RunSkillDeps | undefined;
	promotion?: RunPromotionDeps | undefined;
};

export type StartRunResult = {
	run: RunModel;
	created: boolean;
	sandbox?: SandboxModel | undefined;
	command?: RunCommandModel | undefined;
};

type PublishTarget = "org" | "ws" | "member";

function normalizeErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return String(error);
}

function usesSandbox(spec: RunSpecModel, deps: RunServiceDeps): boolean {
	return spec.profile != null && deps.sandbox != null;
}

function isTerminalStatus(status: RunStatus): boolean {
	return status === "done" || status === "failed";
}

function scopeFromRunSpec(spec: RunSpecModel): TenantScopeContext {
	return {
		orgId: spec.orgId,
		wsId: spec.wsId,
		memberId: spec.memberId,
		writeTarget: spec.writeTarget,
	};
}

export class RunService {
	constructor(private readonly deps: RunServiceDeps) {}

	async startRun(spec: RunSpecModel): Promise<StartRunResult> {
		const runId = spec.runId;
		const created = await this.deps.runRepo.createRun({ runId, spec });
		let run = created.run;

		if (!usesSandbox(spec, this.deps)) {
			if (run.status === "queued" && run.dbosWorkflowId === null) {
				await this.deps.workflowLauncher.startRunOnce(
					{
						runId,
						scope: scopeFromRunSpec(spec),
					},
					{
						workflowID: runId,
					},
				);
				run =
					(await this.deps.runRepo.recordWorkflowLaunch(runId, runId)) ??
					created.run;
			}
			return { run, created: created.created };
		}

		const sandboxDeps = this.requireSandboxDeps();
		const plan = sandboxDeps.createRunPlan(spec);
		const persistedSandbox = await sandboxDeps.sandboxRepo.createSandbox({
			runId,
			spec: plan.sandboxSpec,
			previewSpec: plan.previewSpec,
		});
		if (persistedSandbox.created) {
			await this.appendRunEvent(runId, "run_previewed", {
				preview: plan.previewSpec,
			});
		}
		if (
			persistedSandbox.created &&
			persistedSandbox.sandbox.approvalState === "pending"
		) {
			await this.appendRunEvent(runId, "run_approval_required", {
				profile: persistedSandbox.sandbox.profile,
			});
		}
		const queued = await sandboxDeps.sandboxRepo.queueCommand({
			runId,
			kind: plan.initialCommand.kind,
			payload: plan.initialCommand.payload,
			dedupeKey: plan.initialCommand.dedupeKey,
		});
		if (queued.created) {
			await this.appendRunEvent(runId, "run_command_queued", {
				seq: queued.command.seq,
				kind: queued.command.kind,
			});
		}
		if (
			persistedSandbox.sandbox.approvalState !== "pending" &&
			queued.firstPendingSeq != null
		) {
			const workflowID = toRunSandboxWorkflowId(runId, queued.firstPendingSeq);
			await this.deps.workflowLauncher.startRunOnce(
				{
					runId,
					scope: scopeFromRunSpec(spec),
				},
				{ workflowID },
			);
			run =
				(await this.deps.runRepo.recordWorkflowLaunch(runId, workflowID)) ??
				created.run;
		}

		return {
			run,
			created: created.created,
			sandbox: persistedSandbox.sandbox,
			command: queued.command,
		};
	}

	async queueCommand(input: {
		runId: string;
		kind: RunCommandKind;
		payload?: Record<string, unknown> | undefined;
		dedupeKey?: string | undefined;
	}): Promise<{ command: RunCommandModel; created: boolean }> {
		const sandboxDeps = this.requireSandboxDeps();
		const run = await this.deps.runRepo.getRun(input.runId);
		if (!run) {
			throw new HttpError(404, `run not found: ${input.runId}`);
		}
		if (isTerminalStatus(run.status)) {
			throw new HttpError(
				409,
				`run is terminal (${run.status}); command queue is closed`,
			);
		}
		const sandbox = await this.getSandboxOrThrow(input.runId, sandboxDeps);
		if (sandbox.approvalState === "pending" && input.kind !== "approve") {
			throw new HttpError(
				409,
				"run requires approve before interactive commands",
			);
		}
		await this.assertSkillInvocationExists(input.kind, input.payload);
		const queued = await sandboxDeps.sandboxRepo.queueCommand({
			runId: input.runId,
			kind: input.kind,
			payload: input.payload ?? {},
			dedupeKey: input.dedupeKey,
		});
		if (queued.created) {
			await this.appendRunEvent(input.runId, "run_command_queued", {
				seq: queued.command.seq,
				kind: queued.command.kind,
			});
		}
		if (queued.firstPendingSeq != null) {
			await this.deps.workflowLauncher.startRunOnce(
				{
					runId: input.runId,
					scope: scopeFromRunSpec(run.spec),
				},
				{
					workflowID: toRunSandboxWorkflowId(
						input.runId,
						queued.firstPendingSeq,
					),
				},
			);
		}
		return {
			command: queued.command,
			created: queued.created,
		};
	}

	async getRunState(runId: string): Promise<RunState | null> {
		const run = await this.deps.runRepo.getRun(runId);
		if (!run) {
			return null;
		}
		const artifacts = await this.deps.runRepo.listArtifacts(runId);
		const sandboxDeps = this.deps.sandbox;
		if (!sandboxDeps) {
			return toRunStateContract(run, artifacts);
		}
		const sandbox = await sandboxDeps.sandboxRepo.getSandbox(runId);
		if (!sandbox) {
			return toRunStateContract(run, artifacts);
		}
		const currentCommand =
			await sandboxDeps.sandboxRepo.getCurrentCommand(runId);
		const files =
			sandbox.workspaceRef != null
				? await listWorkspaceFiles({
						workspaceRef: sandbox.workspaceRef,
						artifactService: sandboxDeps.artifactService,
					})
				: undefined;
		return toRunStateContract(run, artifacts, {
			sandbox,
			currentCommand,
			files,
		});
	}

	async listRunEvents(
		runId: string,
		sinceEventId: number,
		limit: number,
	): Promise<RunEvent[]> {
		const events = await this.deps.runRepo.listEventsSince(
			runId,
			sinceEventId,
			limit,
		);
		return events.map(toRunEventContract);
	}

	async getTruthBundle(runId: string): Promise<TruthBundleContract | null> {
		const truth = await this.deps.runRepo.getTruthBundle(runId);
		if (!truth) {
			return null;
		}
		const validated = validateRunByName("TruthBundle", truth);
		if (!validated.valid) {
			throw new Error(
				`truth bundle contract invalid: ${validated.errors.join("; ")}`,
			);
		}
		return truth as TruthBundleContract;
	}

	async searchDocs(input: {
		runId: string;
		query: string;
		scope: string;
		limit?: number | undefined;
	}): Promise<RunDocSearch> {
		await this.requireRun(input.runId);
		const result = await this.requireDocDeps().searchDocs({
			query: input.query,
			scope: input.scope,
			limit: input.limit,
		});
		const validated = validateRunByName("RunDocSearch", result);
		if (!validated.valid) {
			throw new Error(
				`doc search contract invalid: ${validated.errors.join("; ")}`,
			);
		}
		return result;
	}

	async resolveDocSpan(input: {
		runId: string;
		span: SpanRef;
	}): Promise<RunDocResolve | null> {
		await this.requireRun(input.runId);
		const resolved = await this.requireDocDeps().resolveSpan(input.span);
		if (!resolved) {
			return null;
		}
		const validated = validateRunByName("RunDocResolve", resolved);
		if (!validated.valid) {
			throw new Error(
				`doc resolve contract invalid: ${validated.errors.join("; ")}`,
			);
		}
		return resolved;
	}

	async ingestDoc(input: {
		runId: string;
		body: Buffer;
		mime: string;
	}): Promise<{
		docSha: string;
		parseId: string;
		status: "queued" | "rejected" | "deduped";
		reason?: string | undefined;
	}> {
		await this.requireRun(input.runId);
		return this.requireDocDeps().ingestDoc({
			body: input.body,
			mime: input.mime,
		});
	}

	async listSkills(runId: string): Promise<SkillIndexEntry[]> {
		await this.requireRun(runId);
		return this.requireSkillDeps().listSkills();
	}

	async previewSkill(input: {
		runId: string;
		skillName: string;
		args?: string | undefined;
	}): Promise<SkillPreview | null> {
		await this.requireRun(input.runId);
		return this.requireSkillDeps().previewSkill({
			skillName: input.skillName,
			args: input.args,
		});
	}

	async listFiles(runId: string): Promise<{
		workspaceRef?: { sha256: string } | undefined;
		workspace_manifest: {
			version: 1;
			entries: Array<{ path: string; bytes: number; sha256: string }>;
		};
	}> {
		const sandboxDeps = this.requireSandboxDeps();
		const sandbox = await this.getSandboxOrThrow(runId, sandboxDeps);
		if (!sandbox.workspaceRef) {
			return {
				workspace_manifest: {
					version: 1,
					entries: [],
				},
			};
		}
		return listWorkspaceFiles({
			workspaceRef: sandbox.workspaceRef,
			artifactService: sandboxDeps.artifactService,
		});
	}

	async exportFiles(input: {
		runId: string;
		paths?: string[] | undefined;
	}): Promise<{
		workspace_export: { sha256: string };
		workspace_manifest: {
			version: 1;
			entries: Array<{ path: string; bytes: number; sha256: string }>;
		};
	}> {
		const sandboxDeps = this.requireSandboxDeps();
		const sandbox = await this.getSandboxOrThrow(input.runId, sandboxDeps);
		if (!sandbox.workspaceRef) {
			throw new HttpError(409, `workspace snapshot not found: ${input.runId}`);
		}
		const exported = await exportWorkspaceFiles({
			runId: input.runId,
			workspaceRef: sandbox.workspaceRef,
			paths: input.paths,
			artifactService: sandboxDeps.artifactService,
		});
		await this.linkArtifact(
			input.runId,
			exported.workspace_export.sha256,
			"workspace_export",
		);
		await this.appendArtifactWritten(input.runId, {
			sha256: exported.workspace_export.sha256,
			kind: "workspace_export",
		});
		return exported;
	}

	async publishObject(input: {
		runId: string;
		kind: string;
		key: string;
		scope: "me" | "team" | "org";
		writeTarget: PublishTarget;
		publishTarget: PublishTarget;
	}): Promise<{
		sha: string | null;
		fromTarget: PublishTarget;
		publishTarget: PublishTarget;
		workflowID: string;
	}> {
		const run = await this.requireRun(input.runId);
		const kind = input.kind.trim();
		const key = input.key.trim();
		if (!kind || !key) {
			throw new HttpError(400, "publish kind and key are required");
		}
		if (input.scope !== run.spec.scope) {
			throw new HttpError(
				409,
				`publish scope mismatch: expected ${run.spec.scope}, got ${input.scope}`,
			);
		}
		if (input.writeTarget !== run.spec.writeTarget) {
			throw new HttpError(
				409,
				`publish writeTarget mismatch: expected ${run.spec.writeTarget}, got ${input.writeTarget}`,
			);
		}
		if (input.publishTarget === run.spec.writeTarget) {
			throw new HttpError(409, "publishTarget must promote beyond current writeTarget");
		}
		const promotion = this.requirePromotionDeps();
		const fromTarget = run.spec.writeTarget;
		if (fromTarget === "member" && input.publishTarget === "ws") {
			if (!run.spec.wsId || !run.spec.memberId) {
				throw new HttpError(
					409,
					"run spec is missing wsId/memberId for member->ws publish",
				);
			}
			const workflowID = `publish:m2w:${run.runId}:${kind}:${key}`;
			const handle = await DBOS.startWorkflow(promotion.promoteMemberToWs, {
				workflowID,
			})({
				orgId: run.spec.orgId,
				wsId: run.spec.wsId,
				memberId: run.spec.memberId,
				kind,
				key,
			});
			const output = await handle.getResult();
			return {
				sha: output.sha,
				fromTarget,
				publishTarget: input.publishTarget,
				workflowID,
			};
		}
		if (fromTarget === "ws" && input.publishTarget === "org") {
			if (!run.spec.wsId) {
				throw new HttpError(409, "run spec is missing wsId for ws->org publish");
			}
			const workflowID = `publish:w2o:${run.runId}:${kind}:${key}`;
			const handle = await DBOS.startWorkflow(promotion.promoteWsToOrg, {
				workflowID,
			})({
				orgId: run.spec.orgId,
				wsId: run.spec.wsId,
				kind,
				key,
			});
			const output = await handle.getResult();
			return {
				sha: output.sha,
				fromTarget,
				publishTarget: input.publishTarget,
				workflowID,
			};
		}
		throw new HttpError(
			409,
			`unsupported publish transition: ${fromTarget}->${input.publishTarget}`,
		);
	}

	async beginRun(
		runId: string,
		payload: RunEventPayloadMap["run_started"] = {},
	): Promise<RunEventModel> {
		return this.deps.runRepo.beginRun({
			runId,
			workflowId: runId,
			payload,
		});
	}

	async appendPiEvent(
		runId: string,
		payload: RunEventPayloadMap["pi_event"],
	): Promise<RunEventModel> {
		return this.appendRunEvent(runId, "pi_event", payload);
	}

	async appendArtifactWritten(
		runId: string,
		payload: RunEventPayloadMap["artifact_written"],
	): Promise<RunEventModel> {
		return this.appendRunEvent(runId, "artifact_written", payload);
	}

	async appendRunEvent<K extends RunEventKind>(
		runId: string,
		kind: K,
		payload: RunEventPayloadMap[K],
	): Promise<RunEventModel> {
		return this.deps.runRepo.appendEvent({
			runId,
			kind,
			payload,
		});
	}

	async completeRun(
		runId: string,
		payload: CompleteRunInput,
	): Promise<RunModel | null> {
		const eventPayload: RunDonePayload = {
			resultText: payload.resultText,
			stats: payload.stats,
			artifacts: payload.artifacts,
		};
		const updated = await this.deps.runRepo.completeRun({
			runId,
			resultText: payload.resultText,
			resultStats: payload.stats,
			eventPayload,
			piSessionId: payload.piSessionId,
			piSessionFile: payload.piSessionFile,
		});
		return updated.run;
	}

	async failRun(runId: string, error: unknown): Promise<RunModel | null> {
		const message = normalizeErrorMessage(error);
		const eventPayload: RunFailedPayload = { error: message };
		const updated = await this.deps.runRepo.failRun({
			runId,
			error: message,
			eventPayload,
		});
		return updated.run;
	}

	async linkArtifact(
		runId: string,
		sha256: string,
		kind: string,
	): Promise<void> {
		await this.deps.runRepo.linkArtifact({
			runId,
			sha256,
			kind,
		});
	}

	async recordStepLedger(input: RunStepLedgerInput): Promise<void> {
		await this.deps.runRepo.recordStepLedger(input);
	}

	private requireSandboxDeps(): SandboxDeps {
		if (!this.deps.sandbox) {
			throw new HttpError(503, "sandbox control is not configured");
		}
		return this.deps.sandbox;
	}

	private requireDocDeps(): RunDocDeps {
		if (!this.deps.docs) {
			throw new HttpError(503, "doc search is not configured");
		}
		return this.deps.docs;
	}

	private requireSkillDeps(): RunSkillDeps {
		if (!this.deps.skills) {
			throw new HttpError(503, "skills are not configured");
		}
		return this.deps.skills;
	}

	private requirePromotionDeps(): RunPromotionDeps {
		if (!this.deps.promotion) {
			throw new HttpError(503, "publish promotion is not configured");
		}
		return this.deps.promotion;
	}

	private async requireRun(runId: string): Promise<RunModel> {
		const run = await this.deps.runRepo.getRun(runId);
		if (!run) {
			throw new HttpError(404, `run not found: ${runId}`);
		}
		return run;
	}

	private async getSandboxOrThrow(
		runId: string,
		sandboxDeps: SandboxDeps,
	): Promise<SandboxModel> {
		const sandbox = await sandboxDeps.sandboxRepo.getSandbox(runId);
		if (!sandbox) {
			throw new HttpError(404, `run sandbox not found: ${runId}`);
		}
		return sandbox;
	}

	private async assertSkillInvocationExists(
		kind: RunCommandKind,
		payload: Record<string, unknown> | undefined,
	): Promise<void> {
		if (kind !== "prompt" && kind !== "followUp" && kind !== "steer") {
			return;
		}
		const text = payload?.text;
		if (typeof text !== "string") {
			return;
		}
		const invocation = parseSkillInvocation(text);
		if (!invocation) {
			return;
		}
		const skillDeps = this.requireSkillDeps();
		if (!(await skillDeps.hasSkill(invocation.skillName))) {
			throw new HttpError(404, `skill not found: ${invocation.skillName}`);
		}
	}
}
