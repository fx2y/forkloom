import type {
	ActorEvent,
	ActorSpec,
	ActorState,
	MailboxPost,
} from "@forkloom/contracts";
import { apiOrigin, writeJson } from "./run-live-support";

type SseFrame = {
	id: number | null;
	event: string | null;
	data: string | null;
};

type ReadResult = {
	events: ActorEvent[];
	controlFrames: SseFrame[];
};

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
		throw new Error(
			`${label} failed (${response.status}): ${await response.text()}`,
		);
	}
	return (await response.json()) as T;
}

export function makeActorSpec(actorId: string, name = "ops"): ActorSpec {
	return {
		actorId,
		name,
	};
}

export async function createActor(spec: ActorSpec): Promise<ActorState> {
	const response = await fetch(`${apiOrigin()}/actors`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(spec),
	});
	return readJson<ActorState>(response, `create actor ${spec.actorId}`);
}

export async function fetchActorState(actorId: string): Promise<ActorState> {
	const response = await fetch(`${apiOrigin()}/actors/${actorId}`);
	return readJson<ActorState>(response, `fetch actor ${actorId}`);
}

export async function postActorMessage(
	actorId: string,
	payload: MailboxPost,
): Promise<ActorEvent> {
	const response = await fetch(`${apiOrigin()}/actors/${actorId}/messages`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	return readJson<ActorEvent>(response, `post actor message ${actorId}`);
}

export class ActorEventStream {
	private readonly controller = new AbortController();
	private readonly responsePromise: Promise<Response>;
	private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	private readonly decoder = new TextDecoder();
	private buffer = "";

	constructor(
		actorId: string,
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
			`${apiOrigin()}/actors/${actorId}/events${query}`,
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
			throw new Error(
				`open actor SSE failed (${response.status}): ${await response.text()}`,
			);
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
			const chunk = await Promise.race([
				this.reader.read(),
				new Promise<never>((_, reject) => {
					setTimeout(
						() => reject(new Error("timed out waiting for actor SSE")),
						Math.max(1_000, deadline - Date.now()),
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
				if (frame?.event && frame.data) {
					if (frame.event === "gap") {
						result.controlFrames.push(frame);
					} else {
						result.events.push(JSON.parse(frame.data) as ActorEvent);
					}
				}
				if (stopWhen(result)) {
					return result;
				}
				boundary = this.buffer.indexOf("\n\n");
			}
		}

		throw new Error("actor SSE stream ended before stop condition");
	}

	close(): void {
		this.controller.abort();
	}
}

export { writeJson };
