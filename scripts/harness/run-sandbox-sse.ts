import { buildApiRouter } from "../../apps/api/src/http/routes";
import { writeJson } from "./live-support";

type HarnessRunEvent = {
	runId: string;
	seq: number;
	t: string;
	kind: string;
	payload: Record<string, unknown>;
};

class InMemorySandboxRunService {
	private readonly events: HarnessRunEvent[] = [];

	constructor(private readonly runId: string) {}

	async getRunState(): Promise<Record<string, unknown>> {
		return {
			runId: this.runId,
			status: "running",
			startedAt: "2026-02-28T00:00:00.000Z",
			dbosWfId: this.runId,
			preview: {
				imageDigest: "node:24-alpine",
				profile: "safe",
				network: "off",
				workdir: "/work",
				timeoutSec: 900,
				maxBytesOut: 1024,
				mounts: [],
			},
			approval: { required: false, state: "not_required" },
			currentCommand: { seq: 1, kind: "prompt", state: "done" },
			files: { entries: [] },
			artifacts: [],
		};
	}

	async listRunEvents(
		_runId: string,
		sinceEventId: number,
		limit: number,
	): Promise<HarnessRunEvent[]> {
		return this.events
			.filter((event) => event.seq > sinceEventId)
			.slice(0, limit);
	}

	append(
		kind: HarnessRunEvent["kind"],
		payload: Record<string, unknown>,
	): void {
		const seq = this.events.length + 1;
		this.events.push({
			runId: this.runId,
			seq,
			t: `2026-02-28T00:00:0${seq}.000Z`,
			kind,
			payload,
		});
	}
}

async function openSseStream(
	url: string,
	headers: Record<string, string> = {},
): Promise<{
	abort(): void;
	readEvents(expectedCount: number): Promise<HarnessRunEvent[]>;
	checkStillOpen(): Promise<boolean>;
}> {
	const controller = new AbortController();
	const response = await fetch(url, {
		headers,
		signal: controller.signal,
	});
	if (!response.body) {
		throw new Error("missing SSE body");
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	return {
		abort() {
			controller.abort();
		},
		async readEvents(expectedCount: number) {
			const events: HarnessRunEvent[] = [];
			while (events.length < expectedCount) {
				const chunk = await reader.read();
				if (chunk.done) {
					break;
				}
				buffer += decoder.decode(chunk.value, { stream: true });
				let boundary = buffer.indexOf("\n\n");
				while (boundary !== -1) {
					const raw = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const event = parseSseBlock(raw);
					if (event?.event && event.event !== "gap" && event.data) {
						events.push(JSON.parse(event.data) as HarnessRunEvent);
					}
					boundary = buffer.indexOf("\n\n");
				}
			}
			return events;
		},
		async checkStillOpen() {
			const result = await Promise.race([
				reader.read(),
				new Promise<"pending">((resolve) => {
					setTimeout(() => resolve("pending"), 150);
				}),
			]);
			if (result === "pending") {
				return true;
			}
			if (result.done) {
				return false;
			}
			buffer += decoder.decode(result.value, { stream: true });
			return true;
		},
	};
}

function parseSseBlock(
	block: string,
): { event?: string | undefined; data?: string | undefined } | null {
	if (block.startsWith(":")) {
		return null;
	}
	const lines = block.split("\n");
	let event: string | undefined;
	let data: string | undefined;
	for (const line of lines) {
		if (line.startsWith("event: ")) {
			event = line.slice("event: ".length);
		}
		if (line.startsWith("data: ")) {
			data = line.slice("data: ".length);
		}
	}
	return { event, data };
}

async function main(): Promise<void> {
	const runId = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
	const runService = new InMemorySandboxRunService(runId);
	const app = buildApiRouter({
		artifactService: {
			putArtifact: async () => {
				throw new Error("unused");
			},
			getArtifactBytes: async () => {
				throw new Error("unused");
			},
			getArtifactMeta: async () => {
				throw new Error("unused");
			},
			linkArtifact: async () => {
				throw new Error("unused");
			},
		} as never,
		runService: runService as never,
	});
	const server = app.listen(0);

	try {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind harness server");
		}
		const base = `http://127.0.0.1:${address.port}`;
		const firstTab = await openSseStream(`${base}/runs/${runId}/events`);
		const secondTab = await openSseStream(`${base}/runs/${runId}/events`);

		runService.append("run_previewed", { preview: { profile: "safe" } });
		runService.append("run_command_queued", { seq: 1, kind: "prompt" });

		const prefix = await firstTab.readEvents(2);
		await secondTab.readEvents(2);
		const cursor = prefix[prefix.length - 1]?.seq;
		if (!cursor) {
			throw new Error("missing replay cursor");
		}

		secondTab.abort();
		runService.append("run_started", { scope: "team" });
		runService.append("workspace_updated", {
			workspaceRef: { sha256: "a".repeat(64) },
		});
		runService.append("run_aborted", { seq: 1 });

		const replay = await openSseStream(`${base}/runs/${runId}/events`, {
			"Last-Event-ID": String(cursor),
		});
		const replayTail = await replay.readEvents(3);
		const stayedOpen = await replay.checkStillOpen();

		await writeJson(".cache/test-int/run-sandbox-sse.json", {
			runId,
			cursor,
			prefixSeqs: prefix.map((event) => event.seq),
			replaySeqs: replayTail.map((event) => event.seq),
			replayKinds: replayTail.map((event) => event.kind),
			stayedOpenAfterTerminal: stayedOpen,
		});

		firstTab.abort();
		replay.abort();
	} finally {
		await new Promise<void>((resolveClose, rejectClose) => {
			server.close((error) => {
				if (error) {
					rejectClose(error);
					return;
				}
				resolveClose();
			});
		});
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
