import { afterEach, describe, expect, it, vi } from "vitest";
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
		expect(root.querySelector("[data-run-status]")?.textContent).toBe(
			"running",
		);
	});
});
