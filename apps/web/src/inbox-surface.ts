import type { ActorEvent, ActorState } from "@forkloom/contracts";
import {
	type AppDeps,
	type EventSourceLike,
	type UploadedAttachment,
	browserDeps,
	buildActorEventsUrl,
	createActor,
	fetchActor,
	listActors,
	postActorMessage,
	uploadAttachments,
} from "./actor-client";
import {
	type ActorThreadView,
	deriveThreadPresence,
	getSelectedThread,
	initialInboxViewState,
	listInboxThreads,
	reduceActorEvent,
	selectActor,
	summarizeThread,
	upsertActorState,
} from "./state/actor-reducer";
import {
	deriveMailboxKind,
	normalizeActorId,
	resolveComposeTarget,
	toActorSpec,
} from "./thread-compose";

const ACTOR_EVENT_KINDS = [
	"mailbox_queued",
	"session_bound",
	"pi_event",
	"mailbox_processed",
	"mailbox_failed",
] as const;

type PendingStream = {
	actorId: string;
	stream: EventSourceLike;
};

export function mountInboxSurface(
	root: HTMLElement,
	deps: AppDeps = browserDeps(),
) {
	let state = initialInboxViewState;
	let booting = true;
	let creatingThread = false;
	let sending = false;
	let errorMessage = "";
	let uploaded: UploadedAttachment[] = [];
	let activeStream: PendingStream | null = null;

	root.innerHTML = `
		<div class="shell">
			<section class="hero">
				<p class="eyebrow">forkloom / inbox surface</p>
				<h1>Inbox on the left. Truth on the right.</h1>
				<p class="lede">Each thread is one actor mailbox. The thread view is reducer-driven from append-only actor events, not guessed summaries.</p>
			</section>
			<section class="workspace">
				<aside class="panel inbox-panel">
					<div class="panel-head">
						<div>
							<p class="section-label">Inbox</p>
							<h2>Threads</h2>
						</div>
						<span class="status" data-boot-state>booting</span>
					</div>
					<form class="thread-form" data-thread-form>
						<label class="field">
							<span>Open thread</span>
							<input
								data-thread-name
								type="text"
								name="threadName"
								placeholder="ops"
								autocomplete="off"
							/>
						</label>
						<button type="submit" class="secondary">Open</button>
					</form>
					<p class="hint">Use <code>@actor</code> in the composer to route across threads without inventing new API nouns.</p>
					<p class="error" data-error hidden></p>
					<ul class="thread-list" data-thread-list></ul>
				</aside>
				<section class="panel thread-panel">
					<div class="thread-head">
						<div>
							<p class="section-label">Thread</p>
							<h2 data-thread-name-title>No thread selected</h2>
							<p class="thread-meta" data-thread-meta>Open a thread or send to <code>@actor</code>.</p>
						</div>
						<span class="status" data-thread-status data-state="idle">idle</span>
					</div>
					<p class="thread-preview" data-thread-preview>Select a thread to watch actor events and reply history.</p>
					<p class="error" data-thread-error hidden></p>
					<div class="artifact-strip" data-thread-artifacts></div>
					<details class="trace-panel">
						<summary data-trace-summary>Trace 0</summary>
						<ol class="trace-list" data-trace></ol>
					</details>
					<form class="composer" data-compose-form>
						<label class="field">
							<span>Message</span>
							<textarea
								name="message"
								rows="6"
								placeholder="Reply in the selected thread or start with @actor to route elsewhere."
							></textarea>
						</label>
						<div class="composer-meta">
							<label class="field">
								<span>Attachments</span>
								<input data-file-input name="attachments" type="file" multiple />
							</label>
							<div class="upload-list" data-uploads></div>
						</div>
						<p class="hint" data-compose-hint>Idle thread sends become prompts. Streaming thread sends become follow-ups unless you interrupt.</p>
						<div class="actions">
							<button type="submit" class="primary" data-action="send">Send</button>
							<button type="submit" class="warning" data-action="interrupt" hidden>
								Interrupt now
							</button>
						</div>
					</form>
				</section>
			</section>
		</div>
	`;

	const threadForm = root.querySelector<HTMLFormElement>("[data-thread-form]");
	const threadNameInput =
		root.querySelector<HTMLInputElement>("[data-thread-name]");
	const bootNode = root.querySelector<HTMLElement>("[data-boot-state]");
	const errorNode = root.querySelector<HTMLElement>("[data-error]");
	const threadListNode =
		root.querySelector<HTMLUListElement>("[data-thread-list]");
	const threadTitleNode = root.querySelector<HTMLElement>(
		"[data-thread-name-title]",
	);
	const threadMetaNode = root.querySelector<HTMLElement>("[data-thread-meta]");
	const threadStatusNode = root.querySelector<HTMLElement>(
		"[data-thread-status]",
	);
	const threadPreviewNode = root.querySelector<HTMLElement>(
		"[data-thread-preview]",
	);
	const threadErrorNode = root.querySelector<HTMLElement>(
		"[data-thread-error]",
	);
	const artifactNode = root.querySelector<HTMLElement>(
		"[data-thread-artifacts]",
	);
	const traceSummaryNode = root.querySelector<HTMLElement>(
		"[data-trace-summary]",
	);
	const traceNode = root.querySelector<HTMLOListElement>("[data-trace]");
	const composeForm = root.querySelector<HTMLFormElement>(
		"[data-compose-form]",
	);
	const textarea =
		composeForm?.querySelector<HTMLTextAreaElement>(
			'textarea[name="message"]',
		) ?? null;
	const fileInput = root.querySelector<HTMLInputElement>("[data-file-input]");
	const uploadsNode = root.querySelector<HTMLElement>("[data-uploads]");
	const composeHintNode = root.querySelector<HTMLElement>(
		"[data-compose-hint]",
	);
	const interruptButton = root.querySelector<HTMLButtonElement>(
		'[data-action="interrupt"]',
	);
	const sendButton = root.querySelector<HTMLButtonElement>(
		'[data-action="send"]',
	);

	if (
		!(
			threadForm &&
			threadNameInput &&
			bootNode &&
			errorNode &&
			threadListNode &&
			threadTitleNode &&
			threadMetaNode &&
			threadStatusNode &&
			threadPreviewNode &&
			threadErrorNode &&
			artifactNode &&
			traceSummaryNode &&
			traceNode &&
			composeForm &&
			textarea &&
			fileInput &&
			uploadsNode &&
			composeHintNode &&
			interruptButton &&
			sendButton
		)
	) {
		throw new Error("web mount failed: missing required nodes");
	}

	const closeActiveStream = () => {
		activeStream?.stream.close();
		activeStream = null;
	};

	const currentTargetThread = () => {
		try {
			const target = resolveComposeTarget({
				text: textarea.value,
				selectedActorId: state.selectedActorId,
				threads: listInboxThreads(state),
			});
			return state.threads[target.actorId] ?? null;
		} catch {
			return getSelectedThread(state);
		}
	};

	const clearNode = (node: Element) => {
		node.replaceChildren();
	};

	const appendCode = (parent: Element, value: string) => {
		const code = document.createElement("code");
		code.textContent = value;
		parent.append(code);
	};

	const setThreadMeta = (value: {
		prefix: string;
		code?: string;
		suffix?: string;
	}) => {
		clearNode(threadMetaNode);
		threadMetaNode.append(value.prefix);
		if (value.code) {
			appendCode(threadMetaNode, value.code);
		}
		if (value.suffix) {
			threadMetaNode.append(value.suffix);
		}
	};

	const renderThreadList = (threads: ActorThreadView[]) => {
		clearNode(threadListNode);
		for (const thread of threads) {
			const summary = summarizeThread(thread);
			const selected = thread.actor.actorId === state.selectedActorId;
			const item = document.createElement("li");
			const button = document.createElement("button");
			button.type = "button";
			button.className = `thread-list-item${selected ? " is-selected" : ""}`;
			button.dataset.threadSelect = thread.actor.actorId;
			button.setAttribute("aria-current", selected ? "page" : "false");
			const row = document.createElement("span");
			row.className = "thread-list-row";
			const name = document.createElement("strong");
			name.textContent = thread.actor.name;
			const presence = document.createElement("span");
			presence.className = `presence presence-${summary.presence}`;
			presence.textContent = summary.presence;
			row.append(name, presence);
			const preview = document.createElement("span");
			preview.className = "thread-list-preview";
			preview.textContent = summary.preview;
			const meta = document.createElement("span");
			meta.className = "thread-list-meta";
			meta.textContent = thread.actor.actorId;
			button.append(row, preview, meta);
			item.append(button);
			threadListNode.append(item);
		}
	};

	const renderArtifacts = (artifacts: ActorThreadView["artifacts"]) => {
		clearNode(artifactNode);
		for (const artifact of artifacts) {
			const chip = artifact.href
				? document.createElement("a")
				: document.createElement("span");
			chip.className = artifact.href ? "chip chip-link" : "chip";
			if (chip instanceof HTMLAnchorElement && artifact.href) {
				chip.href = artifact.href;
				chip.target = "_blank";
				chip.rel = "noreferrer";
			}
			chip.append(`${artifact.kind}`);
			appendCode(chip, artifact.label);
			artifactNode.append(chip);
		}
	};

	const renderTrace = (trace: ActorThreadView["trace"]) => {
		clearNode(traceNode);
		for (const entry of trace) {
			const item = document.createElement("li");
			const kind = document.createElement("strong");
			kind.textContent = entry.kind;
			const seq = document.createElement("span");
			seq.textContent = `#${entry.seq}`;
			const detail = document.createElement("code");
			detail.textContent = entry.detail;
			item.append(kind, seq, detail);
			traceNode.append(item);
		}
	};

	const renderUploads = () => {
		clearNode(uploadsNode);
		for (const artifact of uploaded) {
			const chip = document.createElement("span");
			chip.className = "chip";
			chip.append(artifact.name);
			appendCode(chip, artifact.sha256.slice(0, 10));
			uploadsNode.append(chip);
		}
	};

	const update = () => {
		const threads = listInboxThreads(state);
		const selectedThread = getSelectedThread(state);
		const targetThread = currentTargetThread();
		const targetPresence = targetThread
			? deriveThreadPresence(targetThread)
			: "idle";
		const defaultKind = deriveMailboxKind({
			interrupt: false,
			thread: targetThread,
		});

		bootNode.textContent = booting
			? "booting"
			: creatingThread
				? "opening"
				: "ready";
		bootNode.dataset.state = booting ? "booting" : "ready";
		errorNode.hidden = errorMessage.length === 0;
		errorNode.textContent = errorMessage;
		renderThreadList(threads);

		if (!selectedThread) {
			threadTitleNode.textContent = "No thread selected";
			setThreadMeta({
				prefix: "Open a thread or route with ",
				code: "@actor",
				suffix: ".",
			});
			threadStatusNode.textContent = "idle";
			threadStatusNode.dataset.state = "idle";
			threadPreviewNode.textContent =
				"Select a thread to watch actor events and reply history.";
			threadErrorNode.hidden = true;
			threadErrorNode.textContent = "";
			clearNode(artifactNode);
			traceSummaryNode.textContent = "Trace 0";
			clearNode(traceNode);
		} else {
			const summary = summarizeThread(selectedThread);
			threadTitleNode.textContent = selectedThread.actor.name;
			setThreadMeta({
				prefix: "actor ",
				code: selectedThread.actor.actorId,
			});
			threadStatusNode.textContent = summary.presence;
			threadStatusNode.dataset.state = summary.presence;
			threadPreviewNode.textContent = summary.preview;
			threadErrorNode.hidden = selectedThread.latestError == null;
			threadErrorNode.textContent = selectedThread.latestError ?? "";
			renderArtifacts(selectedThread.artifacts);
			traceSummaryNode.textContent = `Trace ${selectedThread.trace.length}`;
			renderTrace(selectedThread.trace);
		}

		renderUploads();
		if (state.selectedActorId) {
			clearNode(composeHintNode);
			composeHintNode.append("Default send in this thread is ");
			appendCode(composeHintNode, defaultKind);
			composeHintNode.append(". Prefix with ");
			appendCode(composeHintNode, "@actor");
			composeHintNode.append(" to dispatch elsewhere.");
		} else {
			clearNode(composeHintNode);
			composeHintNode.append("Open a thread or prefix with ");
			appendCode(composeHintNode, "@actor");
			composeHintNode.append(".");
		}
		sendButton.disabled = sending || booting;
		sendButton.textContent = sending ? "Sending..." : `Send ${defaultKind}`;
		interruptButton.hidden = targetPresence !== "streaming";
		interruptButton.disabled = sending || booting;
	};

	const refreshActors = async () => {
		for (const actor of await listActors(deps.fetchImpl)) {
			state = upsertActorState(state, actor);
		}
	};

	const refreshActorState = async (actorId: string) => {
		state = upsertActorState(state, await fetchActor(deps.fetchImpl, actorId));
	};

	const connectThread = (actorId: string) => {
		const thread = state.threads[actorId];
		if (!thread) {
			return;
		}
		if (activeStream?.actorId === actorId) {
			return;
		}
		closeActiveStream();
		const stream = deps.createEventSource(
			buildActorEventsUrl(actorId, thread.lastEventSeq),
		);
		activeStream = { actorId, stream };

		for (const kind of ACTOR_EVENT_KINDS) {
			stream.addEventListener(kind, (message) => {
				const event = JSON.parse(message.data) as ActorEvent;
				state = reduceActorEvent(state, event);
				if (
					event.kind === "mailbox_processed" ||
					event.kind === "mailbox_failed"
				) {
					void refreshActorState(actorId).then(update, () => {});
				}
				update();
			});
		}

		stream.addEventListener("gap", () => {
			errorMessage = "thread stream gap detected; reconnecting";
			update();
			closeActiveStream();
			connectThread(actorId);
		});

		stream.onerror = () => {
			errorMessage = "thread stream interrupted; browser retry active";
			update();
		};
	};

	const ensureActor = async (actorId: string, actorName: string) => {
		const existing = state.threads[actorId]?.actor;
		if (existing) {
			state = selectActor(state, existing.actorId);
			connectThread(existing.actorId);
			return existing;
		}
		const actor = await createActor(
			deps.fetchImpl,
			toActorSpec({
				actorId,
				actorName,
				text: actorName,
				mentioned: false,
			}),
		);
		state = upsertActorState(state, actor);
		state = selectActor(state, actor.actorId);
		connectThread(actor.actorId);
		return actor;
	};

	threadListNode.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}
		const button = target.closest<HTMLElement>("[data-thread-select]");
		const actorId = button?.dataset.threadSelect;
		if (!actorId) {
			return;
		}
		state = selectActor(state, actorId);
		errorMessage = "";
		connectThread(actorId);
		update();
	});

	fileInput.addEventListener("change", () => {
		uploaded = Array.from(fileInput.files ?? []).map((file) => ({
			name: file.name,
			sha256: "",
		}));
		update();
	});

	textarea.addEventListener("input", update);

	threadForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		const name = threadNameInput.value.trim();
		if (name.length === 0) {
			errorMessage = "thread name is required";
			update();
			return;
		}

		try {
			creatingThread = true;
			errorMessage = "";
			update();
			await ensureActor(normalizeActorId(name), name);
			threadNameInput.value = "";
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "thread open failed";
		} finally {
			creatingThread = false;
			update();
		}
	});

	composeForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		try {
			sending = true;
			errorMessage = "";
			update();

			const target = resolveComposeTarget({
				text: textarea.value,
				selectedActorId: state.selectedActorId,
				threads: listInboxThreads(state),
			});
			const submitter = (event as SubmitEvent).submitter;
			const interrupt =
				submitter instanceof HTMLButtonElement &&
				submitter.dataset.action === "interrupt";
			const uploadedFiles = await uploadAttachments(
				deps.fetchImpl,
				Array.from(fileInput.files ?? []),
			);
			uploaded = uploadedFiles;

			await ensureActor(target.actorId, target.actorName);
			const thread = state.threads[target.actorId] ?? null;
			const posted = await postActorMessage(deps.fetchImpl, target.actorId, {
				kind: deriveMailboxKind({ interrupt, thread }),
				text: target.text,
				attachments: uploadedFiles.map(({ sha256 }) => ({ sha256 })),
			});
			state = reduceActorEvent(state, posted);
			state = selectActor(state, target.actorId);
			connectThread(target.actorId);
			void refreshActorState(target.actorId).then(update, () => {});
			textarea.value = "";
			fileInput.value = "";
			uploaded = [];
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "message send failed";
		} finally {
			sending = false;
			update();
		}
	});

	void (async () => {
		try {
			await refreshActors();
			const first = listInboxThreads(state)[0];
			if (first) {
				state = selectActor(state, first.actor.actorId);
				connectThread(first.actor.actorId);
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : "boot failed";
		} finally {
			booting = false;
			update();
		}
	})();

	update();

	return {
		destroy() {
			closeActiveStream();
			root.innerHTML = "";
		},
	};
}
