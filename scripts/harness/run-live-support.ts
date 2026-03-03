import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
	RunEvent,
	RunSpec,
	RunState,
	TruthBundle,
} from "@forkloom/contracts";
import { listReplayStepPayloads } from "../../apps/api/src/workflow/replay";
import { createRunId } from "../../packages/shared/src/run-id";
import {
	type SseFrame,
	apiOrigin,
	asErrorMessage,
	fetchJsonWithRetry,
	fetchWithRetry,
	queryRows,
	readArrayBuffer,
	sleep,
	withPgClient,
	writeJson,
} from "./live-support";
import { JsonEventStream as SharedJsonEventStream } from "./live-support";

type ArtifactMeta = {
	sha256: string;
	uri: string;
	mime: string;
	bytes: number;
	type: string;
	meta: Record<string, unknown>;
};

type RunCreateResponse = {
	runId: string;
	created: boolean;
	status: string;
};

type QueueRunCommandResponse = {
	created: boolean;
	command: {
		seq: number;
		kind: string;
		state: string;
	};
};

export type LiveRunProof = {
	runId: string;
	created: boolean;
	runStartedLatencyMs: number;
	events: RunEvent[];
	controlFrames: SseFrame[];
	runState: RunState;
	attachmentSha256s: string[];
	sessionArtifactSha256: string;
};

const TERMINAL_EVENT_KINDS = new Set<RunEvent["kind"]>([
	"run_done",
	"run_failed",
]);

function isRunEventKind(value: string): value is RunEvent["kind"] {
	return (
		value === "run_started" ||
		value === "pi_event" ||
		value === "artifact_written" ||
		value === "run_done" ||
		value === "run_failed"
	);
}

export function makeRunSpec(input: {
	userMsg: string;
	attachments?: string[] | undefined;
	scope?: RunSpec["scope"] | undefined;
	profile?: RunSpec["profile"] | undefined;
}): RunSpec {
	const spec: RunSpec = {
		runId: createRunId(),
		scope: input.scope ?? "team",
		userMsg: input.userMsg,
		attachments: (input.attachments ?? []).map((sha256) => ({ sha256 })),
		orgId: "00000000-0000-0000-0000-000000000001",
		writeTarget: "ws",
	};
	if (input.profile) {
		spec.profile = input.profile;
	}
	return spec;
}

export async function uploadArtifactBuffer(input: {
	filename: string;
	body: Buffer;
	mime: string;
}): Promise<ArtifactMeta> {
	const form = new FormData();
	form.set(
		"file",
		new File([new Uint8Array(input.body)], input.filename, {
			type: input.mime,
		}),
	);
	return fetchJsonWithRetry<ArtifactMeta>({
		url: `${apiOrigin()}/artifacts`,
		label: `upload ${input.filename}`,
		init: {
			method: "POST",
			body: form,
		},
		maxAttempts: 8,
		retryDelayMs: 300,
	});
}

export async function uploadArtifactFile(path: string): Promise<ArtifactMeta> {
	const body = await readFile(path);
	return uploadArtifactBuffer({
		filename: path.split("/").pop() ?? "artifact.bin",
		body,
		mime: "application/octet-stream",
	});
}

export async function createRun(
	spec: RunSpec,
): Promise<{ requestedAtMs: number; response: RunCreateResponse }> {
	const requestedAtMs = Date.now();
	return {
		requestedAtMs,
		response: await fetchJsonWithRetry<RunCreateResponse>({
			url: `${apiOrigin()}/runs`,
			label: `create run ${spec.runId}`,
			init: {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(spec),
			},
			maxAttempts: 10,
			retryDelayMs: 400,
		}),
	};
}

export async function fetchRunState(runId: string): Promise<RunState> {
	return fetchJsonWithRetry<RunState>({
		url: `${apiOrigin()}/runs/${runId}`,
		label: `fetch run ${runId}`,
		maxAttempts: 8,
		retryDelayMs: 300,
		retryOnStatuses: [404, 502, 503, 504],
	});
}

export async function fetchRunTruth(runId: string): Promise<TruthBundle> {
	return fetchJsonWithRetry<TruthBundle>({
		url: `${apiOrigin()}/runs/${runId}/truth`,
		label: `fetch run truth ${runId}`,
		maxAttempts: 8,
		retryDelayMs: 300,
		retryOnStatuses: [404, 502, 503, 504],
	});
}

export async function queueRunCommand(
	runId: string,
	command: {
		kind: "prompt" | "followUp" | "steer" | "abort" | "approve";
		payload?: Record<string, unknown> | undefined;
	},
): Promise<QueueRunCommandResponse> {
	return fetchJsonWithRetry<QueueRunCommandResponse>({
		url: `${apiOrigin()}/runs/${runId}/commands`,
		label: `queue run command ${runId}`,
		init: {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(command),
		},
		maxAttempts: 10,
		retryDelayMs: 350,
	});
}

export async function waitForReplayablePayload(
	runId: string,
	input: {
		timeoutMs?: number;
		pollIntervalMs?: number;
	} = {},
): Promise<TruthBundle> {
	const timeoutMs = input.timeoutMs ?? 90_000;
	const pollIntervalMs = input.pollIntervalMs ?? 500;
	const deadline = Date.now() + timeoutMs;
	let lastReason = "none";
	while (Date.now() < deadline) {
		try {
			const truth = await fetchRunTruth(runId);
			if (listReplayStepPayloads(truth.stepPayloads).length > 0) {
				return truth;
			}
			lastReason = "missing replayable step payload";
		} catch (error: unknown) {
			lastReason = asErrorMessage(error);
		}
		await sleep(pollIntervalMs);
	}
	throw new Error(
		`run ${runId} missing replayable payload before timeout: ${lastReason}`,
	);
}

export async function waitForRunTerminalState(
	runId: string,
	input: {
		timeoutMs?: number;
		pollIntervalMs?: number;
	} = {},
): Promise<RunState> {
	const timeoutMs = input.timeoutMs ?? 120_000;
	const pollIntervalMs = input.pollIntervalMs ?? 500;
	const deadline = Date.now() + timeoutMs;
	let lastStatus = "unknown";
	while (Date.now() < deadline) {
		const state = await fetchRunState(runId);
		lastStatus = state.status;
		if (
			state.status === "done" ||
			state.status === "failed" ||
			state.status === "aborted"
		) {
			return state;
		}
		await sleep(pollIntervalMs);
	}
	throw new Error(
		`run ${runId} did not reach terminal state before timeout (last status: ${lastStatus})`,
	);
}

export async function fetchArtifactBytes(sha256: string): Promise<Buffer> {
	const response = await fetchWithRetry({
		url: `${apiOrigin()}/artifacts/${sha256}`,
		label: `download ${sha256}`,
		maxAttempts: 8,
		retryDelayMs: 300,
	});
	return Buffer.from(await readArrayBuffer(response, `download ${sha256}`));
}

export async function fetchArtifactDigest(sha256: string): Promise<{
	sha256: string;
	bytes: number;
}> {
	const response = await fetchWithRetry({
		url: `${apiOrigin()}/artifacts/${sha256}`,
		label: `download ${sha256}`,
		maxAttempts: 8,
		retryDelayMs: 300,
	});
	const body = Buffer.from(
		await readArrayBuffer(response, `download ${sha256}`),
	);
	return {
		sha256: createHash("sha256").update(body).digest("hex"),
		bytes: body.byteLength,
	};
}

export class RunEventStream {
	private readonly stream: SharedJsonEventStream<RunEvent>;

	constructor(
		runId: string,
		options: {
			sinceEventId?: number | undefined;
			lastEventId?: number | undefined;
		} = {},
	) {
		this.stream = new SharedJsonEventStream(
			`${apiOrigin()}/runs/${runId}/events`,
			(frame) =>
				frame.event && frame.data && isRunEventKind(frame.event)
					? (JSON.parse(frame.data) as RunEvent)
					: null,
			{
				sinceEventId: options.sinceEventId,
				lastEventId: options.lastEventId,
				timeoutLabel: "SSE",
			},
		);
	}

	async readUntil(
		stopWhen: Parameters<SharedJsonEventStream<RunEvent>["readUntil"]>[0],
		timeoutMs = 30_000,
	) {
		return this.stream.readUntil(stopWhen, timeoutMs);
	}

	close(): void {
		this.stream.close();
	}

	async waitClosed(): Promise<void> {
		await this.stream.waitClosed();
	}
}

export async function runLiveFlow(input: {
	spec: RunSpec;
	timeoutMs?: number | undefined;
}): Promise<LiveRunProof> {
	const created = await createRun(input.spec);
	const stream = new RunEventStream(input.spec.runId);
	try {
		const result = await stream.readUntil(
			(current) =>
				current.events.some((event) => TERMINAL_EVENT_KINDS.has(event.kind)),
			input.timeoutMs,
		);
		const runStarted = result.events.find(
			(event) => event.kind === "run_started",
		);
		if (!runStarted) {
			throw new Error(`run ${input.spec.runId} never emitted run_started`);
		}
		const terminal = result.events.find((event) =>
			TERMINAL_EVENT_KINDS.has(event.kind),
		);
		if (!terminal) {
			throw new Error(`run ${input.spec.runId} never reached terminal state`);
		}
		if (terminal.kind === "run_failed") {
			throw new Error(
				`run ${input.spec.runId} failed: ${String(terminal.payload.error ?? "unknown")}`,
			);
		}
		const sessionArtifactSha256 = result.events
			.filter((event) => event.kind === "artifact_written")
			.map((event) => event.payload)
			.find(
				(payload) =>
					payload.kind === "pi_session_jsonl" &&
					typeof payload.sha256 === "string",
			)?.sha256;
		if (typeof sessionArtifactSha256 !== "string") {
			throw new Error(`run ${input.spec.runId} missing session artifact event`);
		}

		return {
			runId: input.spec.runId,
			created: created.response.created,
			runStartedLatencyMs: Date.parse(runStarted.t) - created.requestedAtMs,
			events: result.events,
			controlFrames: result.controlFrames,
			runState: await fetchRunState(input.spec.runId),
			attachmentSha256s: input.spec.attachments.map(
				(artifact) => artifact.sha256,
			),
			sessionArtifactSha256,
		};
	} finally {
		stream.close();
	}
}

export function summarizeRunFailure(error: unknown): Record<string, unknown> {
	return {
		error: asErrorMessage(error),
	};
}

export { queryRows, withPgClient, writeJson, apiOrigin };
