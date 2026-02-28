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

type JsonEventStreamOptions = {
	sinceEventId?: number | undefined;
	lastEventId?: number | undefined;
	timeoutLabel: string;
};

const DEFAULT_API_ORIGIN = "http://127.0.0.1:8080";
const DEFAULT_DATABASE_URL =
	"postgresql://postgres:postgres@127.0.0.1:5432/agentos";
const DEFAULT_SSE_IDLE_TIMEOUT_MS = 15_000;

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
