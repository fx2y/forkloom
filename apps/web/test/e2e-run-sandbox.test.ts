import type { IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunId } from "../../../packages/shared/src/run-id";
import { mountApp } from "../src/app";

type Listener = (event: MessageEvent<string>) => void;

class FakeEventSource {
	static instances: FakeEventSource[] = [];

	public readonly listeners = new Map<string, Listener[]>();
	public onerror: ((event: Event) => void) | null = null;
	public closed = false;

	constructor(public readonly url: string) {
		FakeEventSource.instances.push(this);
	}

	addEventListener(name: string, listener: Listener): void {
		const listeners = this.listeners.get(name) ?? [];
		listeners.push(listener);
		this.listeners.set(name, listeners);
	}

	emit(name: string, payload: Record<string, unknown>): void {
		const listeners = this.listeners.get(name) ?? [];
		for (const listener of listeners) {
			listener(
				new MessageEvent("message", {
					data: JSON.stringify(payload),
				}),
			);
		}
	}

	close(): void {
		this.closed = true;
	}
}

class LiveEventSource {
	private readonly listeners = new Map<string, Listener[]>();
	private req: ReturnType<typeof httpRequest> | null = null;
	private response: IncomingMessage | null = null;
	private closed = false;
	public onerror: ((event: Event) => void) | null = null;

	constructor(
		private readonly apiOrigin: string,
		private readonly url: string,
	) {
		queueMicrotask(() => {
			this.connect();
		});
	}

	addEventListener(name: string, listener: Listener): void {
		const listeners = this.listeners.get(name) ?? [];
		listeners.push(listener);
		this.listeners.set(name, listeners);
	}

	close(): void {
		this.closed = true;
		this.response?.destroy();
		this.req?.destroy();
	}

	private emit(name: string, data: string): void {
		const listeners = this.listeners.get(name) ?? [];
		for (const listener of listeners) {
			listener(
				new MessageEvent("message", {
					data,
				}),
			);
		}
	}

	private connect(): void {
		const target = new URL(this.url, this.apiOrigin);
		const requestImpl =
			target.protocol === "https:" ? httpsRequest : httpRequest;
		this.req = requestImpl(
			target,
			{ headers: { accept: "text/event-stream" } },
			(response) => {
				this.response = response;
				if ((response.statusCode ?? 500) >= 400) {
					if (!this.closed && this.onerror) {
						this.onerror(new Event("error"));
					}
					return;
				}
				response.setEncoding("utf8");
				let buffer = "";
				let eventName = "message";
				let payloadLines: string[] = [];

				const flush = () => {
					if (payloadLines.length === 0) {
						eventName = "message";
						return;
					}
					this.emit(eventName, payloadLines.join("\n"));
					eventName = "message";
					payloadLines = [];
				};

				response.on("data", (chunk: string) => {
					buffer += chunk;
					while (true) {
						const eol = buffer.indexOf("\n");
						if (eol < 0) {
							break;
						}
						const rawLine = buffer.slice(0, eol);
						buffer = buffer.slice(eol + 1);
						const line = rawLine.endsWith("\r")
							? rawLine.slice(0, rawLine.length - 1)
							: rawLine;
						if (line.length === 0) {
							flush();
							continue;
						}
						if (line.startsWith(":")) {
							continue;
						}
						if (line.startsWith("event:")) {
							eventName = line.slice("event:".length).trim();
							continue;
						}
						if (line.startsWith("data:")) {
							payloadLines.push(line.slice("data:".length).trimStart());
						}
					}
				});

				response.on("end", () => {
					flush();
					if (!this.closed && this.onerror) {
						this.onerror(new Event("error"));
					}
				});
			},
		);
		this.req.on("error", () => {
			if (!this.closed && this.onerror) {
				this.onerror(new Event("error"));
			}
		});
		this.req.end();
	}
}

function createApiFetch(apiOrigin: string): typeof fetch {
	return async (input, init) => {
		if (typeof input === "string") {
			return fetch(new URL(input, apiOrigin), init);
		}
		if (input instanceof URL) {
			return fetch(new URL(input.toString(), apiOrigin), init);
		}
		return fetch(new URL(input.url, apiOrigin), init);
	};
}

async function waitForLiveApiHealth(
	apiOrigin: string,
	input: {
		timeoutMs?: number;
		pollIntervalMs?: number;
		consecutiveSuccesses?: number;
	} = {},
): Promise<void> {
	const timeoutMs = input.timeoutMs ?? 90_000;
	const pollIntervalMs = input.pollIntervalMs ?? 500;
	const consecutiveSuccesses = input.consecutiveSuccesses ?? 3;
	const deadline = Date.now() + timeoutMs;
	let streak = 0;
	let lastFailure = "none";
	while (Date.now() < deadline) {
		try {
			const health = await fetch(new URL("/health", apiOrigin));
			if (health.ok) {
				streak += 1;
				if (streak >= consecutiveSuccesses) {
					return;
				}
			} else {
				streak = 0;
				lastFailure = `status=${health.status}`;
			}
		} catch (error: unknown) {
			streak = 0;
			lastFailure = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}
	throw new Error(
		`api health stability failed: need ${consecutiveSuccesses} consecutive successes, last=${lastFailure}`,
	);
}

describe("web run sandbox flow", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		FakeEventSource.instances = [];
	});

	it("renders WILL-RUN truth, approve wiring, and durable files after workspace updates", async () => {
		const runId = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			const url = String(input);
			if (url === "/actors") {
				return new Response(JSON.stringify([]), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url === "/runs" && init?.method === "POST") {
				return new Response(
					JSON.stringify({
						runId,
						created: true,
						status: "queued",
					}),
					{ status: 201, headers: { "content-type": "application/json" } },
				);
			}
			if (url === `/runs/${runId}`) {
				return new Response(
					JSON.stringify({
						runId,
						status: "awaiting_approval",
						startedAt: "2026-02-28T00:00:00.000Z",
						dbosWfId: runId,
						preview: {
							imageDigest: "node:24-alpine",
							profile: "priv",
							network: "egress",
							workdir: "/work",
							timeoutSec: 900,
							maxBytesOut: 1024,
							mounts: [],
						},
						approval: { required: true, state: "pending" },
						currentCommand: { seq: 1, kind: "prompt", state: "queued" },
						files: { entries: [] },
						artifacts: [],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url === `/runs/${runId}/commands` && init?.method === "POST") {
				return new Response(
					JSON.stringify({
						created: true,
						command: { seq: 2, kind: "approve", state: "queued" },
					}),
					{ status: 202, headers: { "content-type": "application/json" } },
				);
			}
			if (url === `/runs/${runId}/truth`) {
				return new Response(
					JSON.stringify({
						run: {
							runId,
							status: "running",
							spec: {
								runId,
								scope: "team",
								userMsg: "ship it",
								attachments: [],
								profile: "priv",
							},
							createdAt: "2026-02-28T00:00:00.000Z",
							updatedAt: "2026-02-28T00:00:00.000Z",
							dbosWorkflowId: runId,
							piSessionId: "session-1",
							piSessionFile: "/tmp/session.jsonl",
							resultText: null,
							resultStats: null,
							error: null,
						},
						steps: [],
						links: [
							{
								runId,
								stepName: "run_command",
								attempt: 1,
								sessionEntryIds: ["entry-1"],
								artifactShas: ["a".repeat(64)],
								note: "step=run_command",
								createdAt: "2026-02-28T00:00:01.000Z",
							},
						],
						artifacts: [
							{
								runId,
								sha256: "a".repeat(64),
								kind: "pi_session_jsonl",
								createdAt: "2026-02-28T00:00:01.000Z",
							},
						],
						sessionIndex: {
							runId,
							entryCount: 1,
							rootId: "root",
							leafId: "leaf",
							summaryEntryCount: 0,
							updatedAt: "2026-02-28T00:00:01.000Z",
						},
						stepPayloads: [],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url === `/runs/${runId}/files`) {
				return new Response(
					JSON.stringify({
						workspaceRef: { sha256: "a".repeat(64) },
						workspace_manifest: {
							version: 1,
							entries: [
								{
									path: "project/proof.txt",
									bytes: 12,
									sha256: "b".repeat(64),
								},
							],
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			throw new Error(`unexpected fetch ${url}`);
		});

		const root = document.createElement("div");
		document.body.append(root);
		mountApp(root, {
			fetchImpl,
			createEventSource: (url) =>
				new FakeEventSource(url) as unknown as EventSource,
		});

		const runIdInput = root.querySelector<HTMLInputElement>(
			"[data-run-id-input]",
		);
		const promptInput = root.querySelector<HTMLTextAreaElement>(
			"[data-run-prompt-input]",
		);
		const createForm = root.querySelector<HTMLFormElement>(
			"[data-run-create-form]",
		);
		if (!(runIdInput && promptInput && createForm)) {
			throw new Error("missing run create form");
		}

		runIdInput.value = runId;
		promptInput.value = "ship it";
		createForm.dispatchEvent(new Event("submit", { bubbles: true }));

		await vi.waitFor(() => {
			expect(FakeEventSource.instances[0]?.url).toBe(`/runs/${runId}/events`);
		});
		await vi.waitFor(() => {
			expect(root.querySelector("[data-run-preview]")?.textContent).toContain(
				"WILL-RUN priv / egress",
			);
		});
		await vi.waitFor(() => {
			expect(
				root.querySelector("[data-run-provenance]")?.textContent,
			).toContain("run_command#1");
		});

		const approveButton =
			root.querySelector<HTMLButtonElement>("[data-run-approve]");
		if (!approveButton) {
			throw new Error("missing approve button");
		}
		approveButton.click();

		await vi.waitFor(() => {
			expect(fetchImpl).toHaveBeenCalledWith(
				`/runs/${runId}/commands`,
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ kind: "approve" }),
				}),
			);
		});

		const source = FakeEventSource.instances[0];
		if (!source) {
			throw new Error("missing run event stream");
		}
		source.emit("run_approved", {
			runId,
			seq: 1,
			t: "2026-02-28T00:00:01.000Z",
			kind: "run_approved",
			payload: { seq: 2 },
		});
		source.emit("run_started", {
			runId,
			seq: 2,
			t: "2026-02-28T00:00:02.000Z",
			kind: "run_started",
			payload: { scope: "team" },
		});
		source.emit("workspace_updated", {
			runId,
			seq: 3,
			t: "2026-02-28T00:00:03.000Z",
			kind: "workspace_updated",
			payload: { workspaceRef: { sha256: "a".repeat(64) } },
		});

		await vi.waitFor(() => {
			expect(root.querySelector("[data-run-files]")?.textContent).toContain(
				"project/proof.txt",
			);
		});
		expect(root.querySelector("[data-run-provenance]")?.textContent).toContain(
			"session entry-1",
		);
		expect(root.querySelector("[data-run-status]")?.textContent).toBe(
			"running",
		);
	});

	const liveOnly = process.env.FORKLOOM_LIVE_WEB_E2E === "1";
	(liveOnly ? it : it.skip)(
		"runs the real /runs lifecycle with live fetch and live SSE (no mock transport)",
		async () => {
			const apiOrigin =
				process.env.FORKLOOM_API_ORIGIN ?? "http://localhost:8080";
			await waitForLiveApiHealth(apiOrigin);

			const runId = createRunId();
			const root = document.createElement("div");
			document.body.append(root);
			const app = mountApp(root, {
				fetchImpl: createApiFetch(apiOrigin),
				createEventSource: (url) =>
					new LiveEventSource(apiOrigin, url) as unknown as EventSource,
			});

			try {
				const runIdInput = root.querySelector<HTMLInputElement>(
					"[data-run-id-input]",
				);
				const promptInput = root.querySelector<HTMLTextAreaElement>(
					"[data-run-prompt-input]",
				);
				const createForm = root.querySelector<HTMLFormElement>(
					"[data-run-create-form]",
				);
				const abortButton =
					root.querySelector<HTMLButtonElement>("[data-run-abort]");
				if (!(runIdInput && promptInput && createForm && abortButton)) {
					throw new Error("missing run controls");
				}

				runIdInput.value = runId;
				promptInput.value = "summarize operator setup in three bullets";
				createForm.dispatchEvent(new Event("submit", { bubbles: true }));

				await vi.waitFor(
					() => {
						expect(
							root.querySelector("[data-run-preview]")?.textContent,
						).toContain("WILL-RUN safe / off");
						expect(abortButton.disabled).toBe(false);
						expect(
							root.querySelector("[data-run-trace]")?.textContent,
						).toContain("run_started");
					},
					{ timeout: 60_000 },
				);

				abortButton.click();
				await vi.waitFor(
					() => {
						expect(["aborted", "failed"]).toContain(
							root.querySelector("[data-run-status]")?.textContent,
						);
						expect(
							root.querySelector("[data-run-trace]")?.textContent,
						).toContain("run_aborted");
					},
					{ timeout: 60_000 },
				);
			} finally {
				app.destroy();
			}
		},
		90_000,
	);
});
