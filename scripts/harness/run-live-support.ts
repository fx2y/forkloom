import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunEvent, RunSpec, RunState } from "@forkloom/contracts";
import pg from "pg";
import { createRunId } from "../../packages/shared/src/run-id";

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

type SseFrame = {
	id: number | null;
	event: string | null;
	data: string | null;
};

type ReadResult = {
	events: RunEvent[];
	controlFrames: SseFrame[];
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

const DEFAULT_API_ORIGIN = "http://127.0.0.1:8080";
const DEFAULT_DATABASE_URL =
	"postgresql://postgres:postgres@127.0.0.1:5432/agentos";
const TERMINAL_EVENT_KINDS = new Set<RunEvent["kind"]>([
	"run_done",
	"run_failed",
]);

export function apiOrigin(): string {
	return process.env.FORKLOOM_API_ORIGIN ?? DEFAULT_API_ORIGIN;
}

function databaseUrl(): string {
	return (
		process.env.DATABASE_URL ??
		process.env.DBOS_SYSTEM_DATABASE_URL ??
		DEFAULT_DATABASE_URL
	);
}

function asErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRunEventKind(value: string): value is RunEvent["kind"] {
	return (
		value === "run_started" ||
		value === "pi_event" ||
		value === "artifact_written" ||
		value === "run_done" ||
		value === "run_failed"
	);
}

function parseSseFrame(block: string): SseFrame | null {
	if (block.startsWith(":")) {
		return null;
	}

	const lines = block.split("\n");
	let id: number | null = null;
	let event: string | null = null;
	const dataLines: string[] = [];
	for (const line of lines) {
		if (line.startsWith("id: ")) {
			const parsed = Number(line.slice("id: ".length));
			id = Number.isFinite(parsed) ? parsed : null;
			continue;
		}
		if (line.startsWith("event: ")) {
			event = line.slice("event: ".length);
			continue;
		}
		if (line.startsWith("data: ")) {
			dataLines.push(line.slice("data: ".length));
		}
	}

	return {
		id,
		event,
		data: dataLines.length > 0 ? dataLines.join("\n") : null,
	};
}

async function readJson<T>(response: Response, label: string): Promise<T> {
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`${label} failed (${response.status}): ${body}`);
	}
	return (await response.json()) as T;
}

async function readArrayBuffer(
	response: Response,
	label: string,
): Promise<ArrayBuffer> {
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`${label} failed (${response.status}): ${body}`);
	}
	return response.arrayBuffer();
}

export function makeRunSpec(input: {
	userMsg: string;
	attachments?: string[] | undefined;
	scope?: RunSpec["scope"] | undefined;
}): RunSpec {
	return {
		runId: createRunId(),
		scope: input.scope ?? "team",
		userMsg: input.userMsg,
		attachments: (input.attachments ?? []).map((sha256) => ({ sha256 })),
	};
}

export async function writeJson(
	outputPath: string,
	payload: Record<string, unknown>,
): Promise<void> {
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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
	const response = await fetch(`${apiOrigin()}/artifacts`, {
		method: "POST",
		body: form,
	});
	return readJson<ArtifactMeta>(response, `upload ${input.filename}`);
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
	const response = await fetch(`${apiOrigin()}/runs`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(spec),
	});
	return {
		requestedAtMs,
		response: await readJson<RunCreateResponse>(
			response,
			`create run ${spec.runId}`,
		),
	};
}

export async function fetchRunState(runId: string): Promise<RunState> {
	const response = await fetch(`${apiOrigin()}/runs/${runId}`);
	return readJson<RunState>(response, `fetch run ${runId}`);
}

export async function fetchArtifactBytes(sha256: string): Promise<Buffer> {
	const response = await fetch(`${apiOrigin()}/artifacts/${sha256}`);
	return Buffer.from(await readArrayBuffer(response, `download ${sha256}`));
}

export async function fetchArtifactDigest(sha256: string): Promise<{
	sha256: string;
	bytes: number;
}> {
	const response = await fetch(`${apiOrigin()}/artifacts/${sha256}`);
	const body = Buffer.from(
		await readArrayBuffer(response, `download ${sha256}`),
	);
	return {
		sha256: createHash("sha256").update(body).digest("hex"),
		bytes: body.byteLength,
	};
}

export class RunEventStream {
	private readonly controller = new AbortController();
	private readonly responsePromise: Promise<Response>;
	private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	private readonly decoder = new TextDecoder();
	private buffer = "";

	constructor(
		runId: string,
		options: {
			sinceEventId?: number | undefined;
			lastEventId?: number | undefined;
		} = {},
	) {
		const headers: Record<string, string> = {
			accept: "text/event-stream",
		};
		if (options.lastEventId != null) {
			headers["Last-Event-ID"] = String(options.lastEventId);
		}
		const query =
			options.sinceEventId && options.sinceEventId > 0
				? `?since=${options.sinceEventId}`
				: "";
		this.responsePromise = fetch(
			`${apiOrigin()}/runs/${runId}/events${query}`,
			{
				headers,
				signal: this.controller.signal,
			},
		);
	}

	async readUntil(
		stopWhen: (current: ReadResult) => boolean,
		timeoutMs = 30_000,
	): Promise<ReadResult> {
		const response = await this.responsePromise;
		if (!response.ok || !response.body) {
			const body = await response.text();
			throw new Error(`open SSE failed (${response.status}): ${body}`);
		}
		if (!this.reader) {
			this.reader = response.body.getReader();
		}

		const result: ReadResult = {
			events: [],
			controlFrames: [],
		};
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			const remainingMs = deadline - Date.now();
			const chunkTimeoutMs = Math.max(1_000, Math.min(5_000, remainingMs));
			const chunk = await Promise.race([
				this.reader.read(),
				new Promise<never>((_, reject) => {
					setTimeout(
						() => reject(new Error("timed out waiting for SSE")),
						chunkTimeoutMs,
					);
				}),
			]);

			if (chunk.done) {
				break;
			}

			this.buffer += this.decoder.decode(chunk.value, { stream: true });
			let boundary = this.buffer.indexOf("\n\n");
			while (boundary !== -1) {
				const rawBlock = this.buffer.slice(0, boundary);
				this.buffer = this.buffer.slice(boundary + 2);
				const frame = parseSseFrame(rawBlock);
				if (frame?.event && frame.data && isRunEventKind(frame.event)) {
					result.events.push(JSON.parse(frame.data) as RunEvent);
				} else if (frame?.event) {
					result.controlFrames.push(frame);
				}
				if (stopWhen(result)) {
					return result;
				}
				boundary = this.buffer.indexOf("\n\n");
			}
		}

		throw new Error("SSE stream ended before stop condition");
	}

	close(): void {
		this.controller.abort();
	}

	async waitClosed(): Promise<void> {
		const response = await this.responsePromise;
		if (!response.body) {
			return;
		}
		if (!this.reader) {
			this.reader = response.body.getReader();
		}
		while (true) {
			const chunk = await this.reader.read();
			if (chunk.done) {
				return;
			}
		}
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

export async function withPgClient<T>(
	fn: (client: pg.Pool) => Promise<T>,
): Promise<T> {
	const pool = new pg.Pool({ connectionString: databaseUrl() });
	try {
		return await fn(pool);
	} finally {
		await pool.end();
	}
}

export async function queryRows<TRow extends pg.QueryResultRow>(
	text: string,
	values: unknown[] = [],
): Promise<TRow[]> {
	return withPgClient(async (pool) => {
		const result = await pool.query<TRow>(text, values);
		return result.rows;
	});
}

export function summarizeRunFailure(error: unknown): Record<string, unknown> {
	return {
		error: asErrorMessage(error),
	};
}
