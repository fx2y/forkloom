import type {
	RunDocResolve,
	RunDocSearch,
	RunEvent,
	RunState,
	SpanRef,
	TruthBundle,
} from "@forkloom/contracts";
import type { AppDeps } from "./actor-client";

export const RUN_SKILL_CLIENT_ROUTE_TEMPLATES = [
	"GET /runs/:runId/skills",
	"POST /runs/:runId/skills/preview",
] as const;

export const RUN_SKILL_CLIENT_COMMAND_ALIAS = "/skill:";

export type RunSkillListEntry = {
	skillId: string;
	name: string;
	description: string;
	path: string;
	scope: string;
	hidden: boolean;
	menuVisible: boolean;
	allowedTools?: string[] | undefined;
};

export type RunSkillPreview = {
	skillName: string;
	description: string;
	scripts: string[];
	touchedPaths: string[];
	allowedTools?: string[] | undefined;
	manualOnly: boolean;
	menuVisible: boolean;
};

export type RunCreateInput = {
	runId: string;
	scope: "me" | "team" | "org";
	userMsg: string;
	attachments: Array<{ sha256: string }>;
	orgId: string;
	wsId?: string | undefined;
	memberId?: string | undefined;
	writeTarget: "org" | "ws" | "member";
	profile: "safe" | "std" | "priv";
};

type RunCommandInput = {
	kind: "approve" | "prompt" | "followUp" | "steer" | "abort";
	payload?: Record<string, unknown> | undefined;
};

async function readJson<T>(response: Response, label: string): Promise<T> {
	if (!response.ok) {
		throw new Error(`${label} failed (${response.status})`);
	}
	return (await response.json()) as T;
}

export function buildRunEventsUrl(runId: string, sinceEventId: number): string {
	const query =
		sinceEventId > 0
			? `?since=${encodeURIComponent(String(sinceEventId))}`
			: "";
	return `/runs/${runId}/events${query}`;
}

export async function createRun(
	deps: AppDeps,
	input: RunCreateInput,
): Promise<{
	runId: string;
	created: boolean;
	status: string;
}> {
	const response = await deps.fetchImpl("/runs", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	return readJson(response, `create run ${input.runId}`);
}

export async function fetchRun(
	deps: AppDeps,
	runId: string,
): Promise<RunState> {
	const response = await deps.fetchImpl(`/runs/${runId}`);
	return readJson(response, `fetch run ${runId}`);
}

export async function fetchRunTruth(
	deps: AppDeps,
	runId: string,
): Promise<TruthBundle> {
	const response = await deps.fetchImpl(`/runs/${runId}/truth`);
	return readJson(response, `fetch run truth ${runId}`);
}

export async function postRunCommand(
	deps: AppDeps,
	runId: string,
	input: RunCommandInput,
): Promise<{
	created: boolean;
	command: { seq: number; kind: string; state: string };
}> {
	const response = await deps.fetchImpl(`/runs/${runId}/commands`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	return readJson(response, `post run command ${runId}`);
}

export async function publishRunObject(
	deps: AppDeps,
	runId: string,
	input: {
		kind: string;
		key: string;
		scope: "me" | "team" | "org";
		writeTarget: "org" | "ws" | "member";
		publishTarget: "org" | "ws" | "member";
	},
): Promise<{
	sha: string | null;
	fromTarget: "org" | "ws" | "member";
	publishTarget: "org" | "ws" | "member";
	workflowID: string;
}> {
	const response = await deps.fetchImpl(`/runs/${runId}/publish`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	return readJson(response, `publish run object ${runId}`);
}

export async function fetchRunSkills(
	deps: AppDeps,
	runId: string,
): Promise<{ skills: RunSkillListEntry[] }> {
	const response = await deps.fetchImpl(`/runs/${runId}/skills`);
	return readJson(response, `fetch run skills ${runId}`);
}

export async function postRunSkillPreview(
	deps: AppDeps,
	runId: string,
	input: {
		skillName: string;
		args?: string | undefined;
	},
): Promise<RunSkillPreview | null> {
	const response = await deps.fetchImpl(`/runs/${runId}/skills/preview`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	if (response.status === 404) {
		return null;
	}
	return readJson(response, `preview run skill ${runId}`);
}

export async function postRunDocSearch(
	deps: AppDeps,
	runId: string,
	input: {
		query: string;
		scope: string;
		limit?: number | undefined;
	},
): Promise<RunDocSearch> {
	const response = await deps.fetchImpl(`/runs/${runId}/doc/search`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	return readJson(response, `search run docs ${runId}`);
}

export async function postRunDocIngest(
	deps: AppDeps,
	runId: string,
	input: { mime: string; bodyBase64: string },
): Promise<{
	docSha: string;
	parseId: string;
	status: "queued" | "rejected" | "deduped";
	reason?: string | undefined;
}> {
	const response = await deps.fetchImpl(`/runs/${runId}/doc/ingest`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	return readJson(response, `ingest run doc ${runId}`);
}

export async function postRunDocResolve(
	deps: AppDeps,
	runId: string,
	span: SpanRef,
): Promise<RunDocResolve | null> {
	const response = await deps.fetchImpl(`/runs/${runId}/doc/resolve`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ span }),
	});
	if (response.status === 404) {
		return null;
	}
	return readJson(response, `resolve run doc span ${runId}`);
}

export async function fetchRunFiles(
	deps: AppDeps,
	runId: string,
): Promise<{
	workspaceRef?: { sha256: string } | undefined;
	workspace_manifest: {
		version: 1;
		entries: Array<{ path: string; bytes: number; sha256: string }>;
	};
}> {
	const response = await deps.fetchImpl(`/runs/${runId}/files`);
	return readJson(response, `fetch run files ${runId}`);
}

export async function exportRunFiles(
	deps: AppDeps,
	runId: string,
): Promise<{
	workspace_export: { sha256: string };
	workspace_manifest: {
		version: 1;
		entries: Array<{ path: string; bytes: number; sha256: string }>;
	};
}> {
	const response = await deps.fetchImpl(`/runs/${runId}/files/export`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
	return readJson(response, `export run files ${runId}`);
}

export function parseRunEvent(message: MessageEvent<string>): RunEvent {
	return JSON.parse(message.data) as RunEvent;
}
