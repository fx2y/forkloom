import type {
	RunDonePayload,
	RunFailedPayload,
	RunStartedPayload,
} from "@forkloom/contracts";
import type { RunEventKind } from "./event";

export type RunScope = "me" | "team" | "org";
export type RunProfile = "safe" | "std" | "priv";

export type RunStatus = "queued" | "running" | "done" | "failed";

export type ArtifactPointer = {
	sha256: string;
};

export type RunSpecModel = {
	runId: string;
	scope: RunScope;
	userMsg: string;
	attachments: ArtifactPointer[];
	workdirRef?: ArtifactPointer | undefined;
	modelPref?: string | undefined;
	profile?: RunProfile | undefined;
};

export type RunModel = {
	runId: string;
	status: RunStatus;
	spec: RunSpecModel;
	createdAt: string;
	updatedAt: string;
	dbosWorkflowId: string | null;
	piSessionId: string | null;
	piSessionFile: string | null;
	resultText: string | null;
	resultStats: Record<string, unknown> | null;
	error: string | null;
};

export type RunEventModel = {
	eventId: number;
	runId: string;
	kind: RunEventKind;
	payload: Record<string, unknown>;
	createdAt: string;
};

export type RunArtifactLinkModel = {
	runId: string;
	sha256: string;
	kind: string;
	createdAt: string;
};

export type StepModel = {
	runId: string;
	stepName: string;
	attempt: number;
	stepKey: string;
	inHash: string;
	outHash: string | null;
	startedAt: string;
	endedAt: string | null;
};

export type LinkModel = {
	runId: string;
	stepName: string;
	attempt: number;
	sessionEntryIds: string[];
	artifactShas: string[];
	note: string | null;
	createdAt: string;
};

export type SessionIndexModel = {
	runId: string;
	entryCount: number;
	rootId: string | null;
	leafId: string | null;
	summaryEntryCount: number;
	updatedAt: string;
};

export type StepPayloadModel = {
	runId: string;
	stepName: string;
	attempt: number;
	payload: Record<string, unknown>;
	createdAt: string;
};

export type TruthBundle = {
	run: RunModel;
	steps: StepModel[];
	links: LinkModel[];
	artifacts: RunArtifactLinkModel[];
	sessionIndex: SessionIndexModel | null;
	stepPayloads: StepPayloadModel[];
};

export type CreateRunInput = {
	runId: string;
	spec: RunSpecModel;
};

export type AppendRunEventInput = {
	runId: string;
	kind: RunEventKind;
	payload: Record<string, unknown>;
};

export type LinkRunArtifactInput = {
	runId: string;
	sha256: string;
	kind: string;
};

export type CreateStepInput = {
	runId: string;
	stepName: string;
	attempt: number;
	stepKey: string;
	inHash: string;
	outHash?: string | undefined;
	startedAt?: string | undefined;
	endedAt?: string | undefined;
};

export type UpsertLinkInput = {
	runId: string;
	stepName: string;
	attempt: number;
	sessionEntryIds: string[];
	artifactShas: string[];
	note?: string | undefined;
};

export type UpsertSessionIndexInput = {
	runId: string;
	entryCount: number;
	rootId?: string | undefined;
	leafId?: string | undefined;
	summaryEntryCount?: number | undefined;
};

export type UpsertStepPayloadInput = {
	runId: string;
	stepName: string;
	attempt: number;
	payload: Record<string, unknown>;
};

export type RecordStepLedgerInput = {
	runId: string;
	stepName: string;
	attempt: number;
	stepKey: string;
	inHash: string;
	outHash?: string | undefined;
	startedAt?: string | undefined;
	endedAt?: string | undefined;
	sessionEntryIds: string[];
	artifactShas: string[];
	note?: string | undefined;
	payload?: Record<string, unknown> | undefined;
	sessionIndex?:
		| {
				entryCount: number;
				rootId?: string | undefined;
				leafId?: string | undefined;
				summaryEntryCount?: number | undefined;
		  }
		| undefined;
};

export interface RunRepo {
	createRun(
		input: CreateRunInput,
	): Promise<{ run: RunModel; created: boolean }>;
	recordWorkflowLaunch(
		runId: string,
		workflowId: string,
	): Promise<RunModel | null>;
	beginRun(input: {
		runId: string;
		workflowId: string;
		payload: RunStartedPayload;
	}): Promise<RunEventModel>;
	getRun(runId: string): Promise<RunModel | null>;
	appendEvent(input: AppendRunEventInput): Promise<RunEventModel>;
	listEventsSince(
		runId: string,
		sinceEventId: number,
		limit: number,
	): Promise<RunEventModel[]>;
	listArtifacts(runId: string): Promise<RunArtifactLinkModel[]>;
	createStep(input: CreateStepInput): Promise<StepModel>;
	upsertLink(input: UpsertLinkInput): Promise<LinkModel>;
	upsertSessionIndex(
		input: UpsertSessionIndexInput,
	): Promise<SessionIndexModel>;
	upsertStepPayload(input: UpsertStepPayloadInput): Promise<StepPayloadModel>;
	recordStepLedger(input: RecordStepLedgerInput): Promise<void>;
	listSteps(runId: string): Promise<StepModel[]>;
	listLinks(runId: string): Promise<LinkModel[]>;
	listStepPayloads(runId: string): Promise<StepPayloadModel[]>;
	getTruthBundle(runId: string): Promise<TruthBundle | null>;
	completeRun(input: {
		runId: string;
		resultText: string;
		resultStats: Record<string, unknown>;
		eventPayload: RunDonePayload;
		piSessionId?: string | undefined;
		piSessionFile?: string | undefined;
	}): Promise<{ run: RunModel | null; event: RunEventModel | null }>;
	failRun(input: {
		runId: string;
		error: string;
		eventPayload: RunFailedPayload;
	}): Promise<{ run: RunModel | null; event: RunEventModel | null }>;
	linkArtifact(input: LinkRunArtifactInput): Promise<void>;
}
