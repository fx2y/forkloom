import { afterEach, describe, expect, it, vi } from "vitest";
import { mountApp } from "../src/app";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";

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

describe("web run flow", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		FakeEventSource.instances = [];
	});

	it("uploads, starts a run, and renders result artifacts from the event log", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ sha256: "a".repeat(64) }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						runId: RUN_ID,
						created: true,
						status: "running",
					}),
					{
						status: 201,
						headers: { "content-type": "application/json" },
					},
				),
			);

		const root = document.createElement("div");
		document.body.append(root);
		mountApp(root, {
			fetchImpl,
			createEventSource: (url) =>
				new FakeEventSource(url) as unknown as EventSource,
			createRunId: () => RUN_ID,
		});

		const textarea = root.querySelector("textarea");
		const fileInput = root.querySelector('input[type="file"]');
		const form = root.querySelector("form");
		if (!(textarea && fileInput && form instanceof HTMLFormElement)) {
			throw new Error("missing form controls");
		}

		textarea.value = "hello run";
		const file = new File(["hello"], "note.txt", { type: "text/plain" });
		Object.defineProperty(fileInput, "files", {
			value: [file],
			configurable: true,
		});
		fileInput.dispatchEvent(new Event("change"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await vi.waitFor(() => {
			expect(fetchImpl).toHaveBeenCalledTimes(2);
		});

		expect(fetchImpl.mock.calls[0]?.[0]).toBe("/artifacts");
		expect(fetchImpl.mock.calls[1]?.[0]).toBe("/runs");
		expect(FakeEventSource.instances[0]?.url).toBe(`/runs/${RUN_ID}/events`);

		const source = FakeEventSource.instances[0];
		if (!source) {
			throw new Error("missing fake event source");
		}

		source.emit("run_started", {
			runId: RUN_ID,
			seq: 1,
			t: "2026-02-27T00:00:00.000Z",
			kind: "run_started",
			payload: {},
		});
		source.emit("artifact_written", {
			runId: RUN_ID,
			seq: 2,
			t: "2026-02-27T00:00:01.000Z",
			kind: "artifact_written",
			payload: {
				sha256: "b".repeat(64),
				kind: "pi_session_jsonl",
			},
		});
		source.emit("run_done", {
			runId: RUN_ID,
			seq: 3,
			t: "2026-02-27T00:00:02.000Z",
			kind: "run_done",
			payload: {
				resultText: "answer ready",
				artifacts: ["b".repeat(64)],
				stats: {},
			},
		});

		expect(root.querySelector("[data-status]")?.textContent).toBe("done");
		expect(root.querySelector("[data-result]")?.textContent).toContain(
			"answer ready",
		);
		expect(root.querySelectorAll("[data-artifacts] a")).toHaveLength(1);
		expect(root.textContent).toContain("note.txt");
		expect(source.closed).toBe(true);
		expect(root.querySelector("details")?.hasAttribute("open")).toBe(false);
		expect(root.textContent).not.toContain("Abort");
	});

	it("reconnects from the last delivered cursor after a gap frame", async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					runId: RUN_ID,
					created: true,
					status: "running",
				}),
				{
					status: 201,
					headers: { "content-type": "application/json" },
				},
			),
		);

		const root = document.createElement("div");
		document.body.append(root);
		mountApp(root, {
			fetchImpl,
			createEventSource: (url) =>
				new FakeEventSource(url) as unknown as EventSource,
			createRunId: () => RUN_ID,
		});

		const textarea = root.querySelector("textarea");
		const form = root.querySelector("form");
		if (!(textarea && form instanceof HTMLFormElement)) {
			throw new Error("missing form controls");
		}

		textarea.value = "hello run";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await vi.waitFor(() => {
			expect(FakeEventSource.instances[0]?.url).toBe(`/runs/${RUN_ID}/events`);
		});

		const first = FakeEventSource.instances[0];
		if (!first) {
			throw new Error("missing initial fake event source");
		}

		first.emit("run_started", {
			runId: RUN_ID,
			seq: 1,
			t: "2026-02-27T00:00:00.000Z",
			kind: "run_started",
			payload: {},
		});
		first.emit("gap", { reason: "overflow", reconnectFrom: 1 });

		await vi.waitFor(() => {
			expect(FakeEventSource.instances[1]?.url).toBe(
				`/runs/${RUN_ID}/events?since=1`,
			);
		});
	});
});
