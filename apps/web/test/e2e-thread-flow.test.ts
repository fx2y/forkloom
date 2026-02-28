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

describe("web thread flow", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		FakeEventSource.instances = [];
	});

	it("boots an inbox, replays actor events, and routes follow-up vs interrupt truthfully", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify([
						{
							actorId: "ops",
							name: "Ops",
							status: "idle",
							mailboxCursor: 0,
							updatedAt: "2026-02-28T00:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						actorId: "ops",
						name: "Ops",
						status: "idle",
						mailboxCursor: 0,
						updatedAt: "2026-02-28T00:00:00.000Z",
					}),
					{ status: 201, headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						actorId: "ops",
						seq: 3,
						t: "2026-02-28T00:00:03.000Z",
						kind: "mailbox_queued",
						payload: { seq: 2, kind: "followUp" },
					}),
					{ status: 201, headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						actorId: "ops",
						name: "Ops",
						status: "idle",
						mailboxCursor: 2,
						updatedAt: "2026-02-28T00:00:03.000Z",
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						actorId: "ops",
						name: "Ops",
						status: "idle",
						mailboxCursor: 2,
						updatedAt: "2026-02-28T00:00:03.000Z",
					}),
					{ status: 201, headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						actorId: "ops",
						seq: 4,
						t: "2026-02-28T00:00:04.000Z",
						kind: "mailbox_queued",
						payload: { seq: 3, kind: "steer" },
					}),
					{ status: 201, headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						actorId: "ops",
						name: "Ops",
						status: "idle",
						mailboxCursor: 3,
						updatedAt: "2026-02-28T00:00:04.000Z",
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);

		const root = document.createElement("div");
		document.body.append(root);
		mountApp(root, {
			fetchImpl,
			createEventSource: (url) =>
				new FakeEventSource(url) as unknown as EventSource,
		});

		await vi.waitFor(() => {
			expect(FakeEventSource.instances[0]?.url).toBe("/actors/ops/events");
		});

		const source = FakeEventSource.instances[0];
		if (!source) {
			throw new Error("missing actor event stream");
		}

		source.emit("mailbox_queued", {
			actorId: "ops",
			seq: 1,
			t: "2026-02-28T00:00:01.000Z",
			kind: "mailbox_queued",
			payload: { seq: 1, kind: "prompt" },
		});
		source.emit("session_bound", {
			actorId: "ops",
			seq: 2,
			t: "2026-02-28T00:00:02.000Z",
			kind: "session_bound",
			payload: {
				seq: 1,
				sessionId: "s-1",
				sessionFile: "/tmp/pi/session-1.jsonl",
			},
		});

		const textarea = root.querySelector("textarea");
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("missing message textarea");
		}
		textarea.value = "keep going";
		textarea.dispatchEvent(new Event("input", { bubbles: true }));

		await vi.waitFor(() => {
			expect(root.textContent).toContain("Interrupt now");
		});
		expect(root.querySelector("[data-thread-preview]")?.textContent).toContain(
			"session s-1",
		);
		expect(
			root.querySelector("[data-thread-artifacts]")?.textContent,
		).toContain("session");

		const sendButton = root.querySelector<HTMLButtonElement>(
			'[data-action="send"]',
		);
		if (!sendButton) {
			throw new Error("missing send button");
		}
		sendButton.click();

		await vi.waitFor(() => {
			expect(fetchImpl).toHaveBeenCalledWith(
				"/actors/ops/messages",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({
						kind: "followUp",
						text: "keep going",
						attachments: [],
					}),
				}),
			);
		});

		textarea.value = "stop after this tool";
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
		const interruptButton = root.querySelector<HTMLButtonElement>(
			'[data-action="interrupt"]',
		);
		if (!interruptButton) {
			throw new Error("missing interrupt button");
		}
		interruptButton.click();

		await vi.waitFor(() => {
			expect(fetchImpl).toHaveBeenCalledWith(
				"/actors/ops/messages",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({
						kind: "steer",
						text: "stop after this tool",
						attachments: [],
					}),
				}),
			);
		});
	});

	it("creates a thread from @actor routing and strips the mention before send", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify([]), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						actorId: "build",
						name: "build",
						status: "idle",
						mailboxCursor: 0,
						updatedAt: "2026-02-28T00:00:00.000Z",
					}),
					{ status: 201, headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						actorId: "build",
						seq: 1,
						t: "2026-02-28T00:00:01.000Z",
						kind: "mailbox_queued",
						payload: { seq: 1, kind: "prompt" },
					}),
					{ status: 201, headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						actorId: "build",
						name: "build",
						status: "idle",
						mailboxCursor: 1,
						updatedAt: "2026-02-28T00:00:01.000Z",
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);

		const root = document.createElement("div");
		document.body.append(root);
		mountApp(root, {
			fetchImpl,
			createEventSource: (url) =>
				new FakeEventSource(url) as unknown as EventSource,
		});

		await vi.waitFor(() => {
			expect(root.querySelector("[data-boot-state]")?.textContent).toBe(
				"ready",
			);
		});

		const textarea = root.querySelector("textarea");
		const sendButton = root.querySelector<HTMLButtonElement>(
			'[data-action="send"]',
		);
		if (!(textarea instanceof HTMLTextAreaElement) || !sendButton) {
			throw new Error("missing composer");
		}
		textarea.value = "@build ship it";
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
		sendButton.click();

		await vi.waitFor(() => {
			expect(
				fetchImpl.mock.calls.some(
					([url, init]) =>
						url === "/actors" &&
						init != null &&
						typeof init === "object" &&
						"method" in init &&
						init.method === "POST" &&
						"body" in init &&
						init.body ===
							JSON.stringify({
								actorId: "build",
								name: "build",
							}),
				),
			).toBe(true);
		});
		expect(
			fetchImpl.mock.calls.some(
				([url, init]) =>
					url === "/actors/build/messages" &&
					init != null &&
					typeof init === "object" &&
					"method" in init &&
					init.method === "POST" &&
					"body" in init &&
					init.body ===
						JSON.stringify({
							kind: "prompt",
							text: "ship it",
							attachments: [],
						}),
			),
		).toBe(true);
		expect(FakeEventSource.instances[0]?.url).toBe("/actors/build/events");
	});

	it("renders hostile actor text as text nodes instead of executable HTML", async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
			new Response(
				JSON.stringify([
					{
						actorId: "ops",
						name: '<img src=x onerror="window.__xss=1">',
						status: "idle",
						mailboxCursor: 0,
						updatedAt: "2026-02-28T00:00:00.000Z",
					},
				]),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);

		const root = document.createElement("div");
		document.body.append(root);
		mountApp(root, {
			fetchImpl,
			createEventSource: (url) =>
				new FakeEventSource(url) as unknown as EventSource,
		});

		await vi.waitFor(() => {
			expect(root.textContent).toContain(
				'<img src=x onerror="window.__xss=1">',
			);
		});

		const source = FakeEventSource.instances[0];
		if (!source) {
			throw new Error("missing actor event stream");
		}
		source.emit("mailbox_processed", {
			actorId: "ops",
			seq: 1,
			t: "2026-02-28T00:00:01.000Z",
			kind: "mailbox_processed",
			payload: {
				seq: 1,
				kind: "prompt",
				lastAssistantText: "<script>window.__xss=2</script>",
			},
		});

		await vi.waitFor(() => {
			expect(root.textContent).toContain("<script>window.__xss=2</script>");
		});
		expect(root.querySelector("img")).toBeNull();
		expect(root.querySelector("script")).toBeNull();
	});
});
