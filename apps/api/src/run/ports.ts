import type { RunEventKind } from "./event";

export type RunScope = "me" | "team" | "org";

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
	error: string | null;
};

export type RunEventModel = {
	eventId: number;
	runId: string;
	kind: RunEventKind;
	payload: Record<string, unknown>;
	createdAt: string;
};

export type CreateRunInput = {
	runId: string;
	workflowId: string;
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

export interface RunRepo {
	createRun(
		input: CreateRunInput,
	): Promise<{ run: RunModel; created: boolean }>;
	getRun(runId: string): Promise<RunModel | null>;
	appendEvent(input: AppendRunEventInput): Promise<RunEventModel>;
	listEventsSince(
		runId: string,
		sinceEventId: number,
		limit: number,
	): Promise<RunEventModel[]>;
	markDone(input: {
		runId: string;
		resultText: string;
		piSessionId?: string | undefined;
		piSessionFile?: string | undefined;
	}): Promise<RunModel | null>;
	markFailed(runId: string, error: string): Promise<RunModel | null>;
	linkArtifact(input: LinkRunArtifactInput): Promise<void>;
}
