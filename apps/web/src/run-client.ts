import type { RunEvent, RunState } from "@forkloom/contracts";
import type { AppDeps } from "./actor-client";

type RunCreateInput = {
	runId: string;
	scope: "me" | "team" | "org";
	userMsg: string;
	attachments: Array<{ sha256: string }>;
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
