import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import pg from "pg";

export type SseFrame = {
	id: number | null;
	event: string | null;
	data: string | null;
};

export type SseReadResult<TEvent> = {
	events: TEvent[];
	controlFrames: SseFrame[];
};

type RetryFetchInput = {
	url: string | URL;
	label: string;
	init?: RequestInit | undefined;
	maxAttempts?: number | undefined;
	retryDelayMs?: number | undefined;
	retryOnStatuses?: readonly number[] | undefined;
	retryOnAny5xx?: boolean | undefined;
};

type ApiHealthStableInput = {
	timeoutMs?: number | undefined;
	pollIntervalMs?: number | undefined;
	consecutiveSuccesses?: number | undefined;
	requireDeps?: boolean | undefined;
};

type JsonEventStreamOptions = {
	sinceEventId?: number | undefined;
	lastEventId?: number | undefined;
	timeoutLabel: string;
};

const DEFAULT_API_ORIGIN = "http://127.0.0.1:8080";
const DEFAULT_DATABASE_URL =
	"postgresql://postgres:postgres@127.0.0.1:5432/agentos";
const DEFAULT_SSE_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_ATTEMPTS = 8;
const DEFAULT_RETRY_DELAY_MS = 350;
const DEFAULT_RETRYABLE_STATUSES = [502, 503, 504] as const;
const DEFAULT_HEALTH_TIMEOUT_MS = 90_000;
const DEFAULT_HEALTH_INTERVAL_MS = 500;
const DEFAULT_HEALTH_CONSECUTIVE_SUCCESSES = 3;
const DEFAULT_RUN_SCOPE_HEADERS = {
	"x-org-id":
		process.env.FORKLOOM_TEST_ORG_ID ?? "00000000-0000-0000-0000-000000000001",
	"x-ws-id":
		process.env.FORKLOOM_TEST_WS_ID ?? "00000000-0000-0000-0000-000000000002",
	"x-write-scope": process.env.FORKLOOM_TEST_WRITE_SCOPE ?? "ws",
} as const;

function withRunScopeHeaders(
	url: string | URL,
	init: RequestInit | undefined,
): RequestInit | undefined {
	const parsedUrl =
		typeof url === "string"
			? new URL(url, apiOrigin())
			: new URL(url.toString());
	if (!parsedUrl.pathname.startsWith("/runs")) {
		return init;
	}
	const headers = new Headers(init?.headers ?? undefined);
	for (const [key, value] of Object.entries(DEFAULT_RUN_SCOPE_HEADERS)) {
		if (!headers.has(key)) {
			headers.set(key, value);
		}
	}
	return {
		...(init ?? {}),
		headers,
	};
}

function databaseUrl(): string {
	return (
		process.env.DATABASE_URL ??
		process.env.DBOS_SYSTEM_DATABASE_URL ??
		DEFAULT_DATABASE_URL
	);
}

export function apiOrigin(): string {
	return process.env.FORKLOOM_API_ORIGIN ?? DEFAULT_API_ORIGIN;
}

export function asErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function sleep(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function writeJson(
	outputPath: string,
	payload: Record<string, unknown>,
): Promise<void> {
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function readJson<T>(
	response: Response,
	label: string,
): Promise<T> {
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`${label} failed (${response.status}): ${body}`);
	}
	return (await response.json()) as T;
}

export async function readArrayBuffer(
	response: Response,
	label: string,
): Promise<ArrayBuffer> {
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`${label} failed (${response.status}): ${body}`);
	}
	return response.arrayBuffer();
}

function isRetryableStatus(status: number, input: RetryFetchInput): boolean {
	if (input.retryOnAny5xx !== false && status >= 500) {
		return true;
	}
	const retryOnStatuses = input.retryOnStatuses ?? DEFAULT_RETRYABLE_STATUSES;
	return retryOnStatuses.includes(status);
}

export async function fetchWithRetry(
	input: RetryFetchInput,
): Promise<Response> {
	const maxAttempts = Math.max(1, input.maxAttempts ?? DEFAULT_RETRY_ATTEMPTS);
	const retryDelayMs = Math.max(
		1,
		input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
	);
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			const response = await fetch(
				input.url,
				withRunScopeHeaders(input.url, input.init),
			);
			if (!isRetryableStatus(response.status, input)) {
				return response;
			}
			lastError = new Error(
				`${input.label} retryable status ${response.status} (attempt ${attempt}/${maxAttempts})`,
			);
		} catch (error: unknown) {
			lastError = error;
		}
		if (attempt < maxAttempts) {
			await sleep(retryDelayMs);
		}
	}
	throw new Error(
		`${input.label} failed after ${maxAttempts} attempts: ${asErrorMessage(lastError)}`,
	);
}

export async function fetchJsonWithRetry<T>(
	input: RetryFetchInput,
): Promise<T> {
	const response = await fetchWithRetry(input);
	return readJson<T>(response, input.label);
}

export async function waitForApiHealthyStable(
	input: ApiHealthStableInput = {},
): Promise<void> {
	const timeoutMs = Math.max(
		1_000,
		input.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
	);
	const pollIntervalMs = Math.max(
		100,
		input.pollIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS,
	);
	const consecutiveSuccesses = Math.max(
		1,
		input.consecutiveSuccesses ?? DEFAULT_HEALTH_CONSECUTIVE_SUCCESSES,
	);
	const requireDeps = input.requireDeps ?? false;
	const deadline = Date.now() + timeoutMs;
	let attempts = 0;
	let healthyStreak = 0;
	let lastFailure = "none";
	while (Date.now() < deadline) {
		attempts += 1;
		try {
			const response = await fetch(new URL("/health", apiOrigin()));
			if (!response.ok) {
				healthyStreak = 0;
				lastFailure = `status=${response.status}`;
			} else if (requireDeps) {
				const payload = (await response.json()) as {
					deps?: Record<string, unknown> | undefined;
				};
				const depsOk =
					typeof payload.deps?.pg === "boolean" &&
					payload.deps.pg === true &&
					typeof payload.deps.s3 === "boolean" &&
					payload.deps.s3 === true &&
					typeof payload.deps.pi === "boolean" &&
					payload.deps.pi === true &&
					typeof payload.deps.api === "boolean" &&
					payload.deps.api === true;
				if (!depsOk) {
					healthyStreak = 0;
					lastFailure = "deps_not_ready";
				} else {
					healthyStreak += 1;
				}
			} else {
				healthyStreak += 1;
			}
			if (healthyStreak >= consecutiveSuccesses) {
				return;
			}
		} catch (error: unknown) {
			healthyStreak = 0;
			lastFailure = asErrorMessage(error);
		}
		await sleep(pollIntervalMs);
	}
	throw new Error(
		`api health quorum not reached after ${attempts} probes (need ${consecutiveSuccesses} consecutive successes; last failure: ${lastFailure})`,
	);
}

export function parseSseFrame(block: string): SseFrame | null {
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

export class JsonEventStream<TEvent> {
	private readonly controller = new AbortController();
	private readonly responsePromise: Promise<Response>;
	private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	private readonly decoder = new TextDecoder();
	private buffer = "";

	constructor(
		url: string,
		private readonly parseEvent: (frame: SseFrame) => TEvent | null,
		private readonly options: JsonEventStreamOptions,
	) {
		const headers: Record<string, string> = {
			accept: "text/event-stream",
		};
		const scopeHeaders = withRunScopeHeaders(url, undefined)?.headers;
		if (scopeHeaders instanceof Headers) {
			for (const [key, value] of scopeHeaders.entries()) {
				headers[key] = value;
			}
		}
		if (options.lastEventId != null) {
			headers["Last-Event-ID"] = String(options.lastEventId);
		}
		const query =
			options.sinceEventId && options.sinceEventId > 0
				? `?since=${options.sinceEventId}`
				: "";
		this.responsePromise = fetch(`${url}${query}`, {
			headers,
			signal: this.controller.signal,
		});
	}

	async readUntil(
		stopWhen: (current: SseReadResult<TEvent>) => boolean,
		timeoutMs = 30_000,
	): Promise<SseReadResult<TEvent>> {
		const response = await this.responsePromise;
		if (!response.ok || !response.body) {
			const body = await response.text();
			throw new Error(
				`open ${this.options.timeoutLabel} failed (${response.status}): ${body}`,
			);
		}
		if (!this.reader) {
			this.reader = response.body.getReader();
		}

		const result: SseReadResult<TEvent> = {
			events: [],
			controlFrames: [],
		};
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			const remainingMs = deadline - Date.now();
			const chunkTimeoutMs = Math.max(
				1_000,
				Math.min(DEFAULT_SSE_IDLE_TIMEOUT_MS, remainingMs),
			);
			const chunk = await Promise.race([
				this.reader.read(),
				new Promise<never>((_, reject) => {
					setTimeout(
						() =>
							reject(
								new Error(`timed out waiting for ${this.options.timeoutLabel}`),
							),
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
				if (frame?.event) {
					const event = this.parseEvent(frame);
					if (event) {
						result.events.push(event);
					} else {
						result.controlFrames.push(frame);
					}
				}
				if (stopWhen(result)) {
					return result;
				}
				boundary = this.buffer.indexOf("\n\n");
			}
		}

		throw new Error(
			`${this.options.timeoutLabel} stream ended before stop condition`,
		);
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
