import type { RunEvent } from "@forkloom/contracts";
import { createRunId } from "./run-id";
import {
	type RunViewState,
	initialRunViewState,
	reduceRunEvent,
} from "./state/reducer";
import "./styles.css";

type Scope = "me" | "team" | "org";

type AppDeps = {
	fetchImpl: typeof fetch;
	createEventSource(url: string): EventSourceLike;
	createRunId(): string;
};

type EventSourceLike = {
	addEventListener(
		name: string,
		listener: (event: MessageEvent<string>) => void,
	): void;
	close(): void;
	onerror: ((event: Event) => void) | null;
};

type UploadedAttachment = {
	name: string;
	sha256: string;
};

export function buildRunEventsUrl(runId: string, sinceEventId: number): string {
	const query =
		sinceEventId > 0
			? `?since=${encodeURIComponent(String(sinceEventId))}`
			: "";
	return `/runs/${runId}/events${query}`;
}

function browserDeps(): AppDeps {
	return {
		fetchImpl: fetch,
		createEventSource: (url) => new EventSource(url),
		createRunId,
	};
}

function renderStatus(state: RunViewState, submitting: boolean): string {
	if (submitting) {
		return "staging inputs";
	}
	switch (state.status) {
		case "running":
			return "streaming";
		case "done":
			return "done";
		case "failed":
			return "failed";
		default:
			return "idle";
	}
}

export function mountApp(root: HTMLElement, deps: AppDeps = browserDeps()) {
	let scope: Scope = "team";
	let submitting = false;
	let errorMessage = "";
	let uploaded: UploadedAttachment[] = [];
	let state = initialRunViewState;
	let stream: EventSourceLike | null = null;

	root.innerHTML = `
		<div class="shell">
			<section class="hero">
				<p class="eyebrow">forkloom / run surface</p>
				<h1>One truthful screen for durable runs.</h1>
				<p class="lede">Upload, ask, watch the DB-backed event log, and collect artifacts from the same flow.</p>
			</section>
			<section class="panel panel-compose">
				<form data-form class="composer">
					<label class="field">
						<span>Prompt</span>
						<textarea name="userMsg" rows="6" placeholder="Describe the run you want."></textarea>
					</label>
					<div class="split">
						<label class="field">
							<span>Attachments</span>
							<input name="attachments" type="file" multiple />
						</label>
						<fieldset class="field scopes">
							<legend>Scope</legend>
							<label><input type="radio" name="scope" value="me" /> Me</label>
							<label><input type="radio" name="scope" value="team" checked /> Team</label>
							<label><input type="radio" name="scope" value="org" /> Org</label>
						</fieldset>
					</div>
						<div class="upload-list" data-uploads></div>
						<div class="actions">
							<button type="submit" class="primary">Start run</button>
						</div>
					</form>
				</section>
			<section class="grid">
				<article class="panel panel-result">
					<div class="panel-head">
						<h2>Result</h2>
						<span class="status" data-status>idle</span>
					</div>
					<p class="run-id" data-run-id>No run started.</p>
					<p class="error" data-error hidden></p>
					<div class="result-text" data-result>Final text appears here.</div>
					<div class="chips" data-artifacts></div>
				</article>
					<details class="panel trace">
						<summary>Trace drawer</summary>
						<ol data-trace class="trace-list"></ol>
					</details>
			</section>
		</div>
	`;

	const form = root.querySelector("[data-form]");
	const textarea = root.querySelector<HTMLTextAreaElement>(
		'textarea[name="userMsg"]',
	);
	const fileInput = root.querySelector<HTMLInputElement>(
		'input[name="attachments"]',
	);
	const status = root.querySelector<HTMLElement>("[data-status]");
	const runIdNode = root.querySelector<HTMLElement>("[data-run-id]");
	const errorNode = root.querySelector<HTMLElement>("[data-error]");
	const uploadsNode = root.querySelector<HTMLElement>("[data-uploads]");
	const resultNode = root.querySelector<HTMLElement>("[data-result]");
	const artifactsNode = root.querySelector<HTMLElement>("[data-artifacts]");
	const traceNode = root.querySelector<HTMLOListElement>("[data-trace]");

	if (
		!(
			form &&
			textarea &&
			fileInput &&
			status &&
			runIdNode &&
			errorNode &&
			uploadsNode &&
			resultNode &&
			artifactsNode &&
			traceNode
		)
	) {
		throw new Error("web mount failed: missing required nodes");
	}

	const update = () => {
		status.textContent = renderStatus(state, submitting);
		status.dataset.state = state.status;
		runIdNode.textContent = state.runId
			? `run ${state.runId}`
			: "No run started.";
		errorNode.hidden = errorMessage.length === 0;
		errorNode.textContent = errorMessage;
		resultNode.textContent = state.resultText || "Final text appears here.";
		uploadsNode.innerHTML = uploaded
			.map(
				(artifact) =>
					`<span class="chip">${artifact.name}<code>${artifact.sha256.slice(0, 10)}</code></span>`,
			)
			.join("");
		artifactsNode.innerHTML = state.artifacts
			.map(
				(artifact) =>
					`<a class="chip chip-link" href="${artifact.href}" target="_blank" rel="noreferrer">${artifact.kind}<code>${artifact.sha256.slice(0, 10)}</code></a>`,
			)
			.join("");
		traceNode.innerHTML = state.trace
			.map(
				(event) =>
					`<li><strong>${event.kind}</strong><span>#${event.seq}</span><code>${JSON.stringify(event.payload)}</code></li>`,
			)
			.join("");
	};

	const applyEvent = (event: RunEvent) => {
		state = reduceRunEvent(state, event);
		if (event.kind === "run_failed") {
			errorMessage =
				typeof event.payload.error === "string"
					? event.payload.error
					: "run failed";
		}
		if (event.kind === "run_done" || event.kind === "run_failed") {
			stream?.close();
			stream = null;
		}
		update();
	};

	const connect = (runId: string, sinceEventId = state.lastSeq) => {
		stream?.close();
		stream = deps.createEventSource(buildRunEventsUrl(runId, sinceEventId));
		for (const kind of [
			"run_started",
			"pi_event",
			"artifact_written",
			"run_done",
			"run_failed",
		] as const) {
			stream.addEventListener(kind, (event) => {
				applyEvent(JSON.parse(event.data) as RunEvent);
			});
		}
		stream.addEventListener("gap", () => {
			errorMessage = "stream gap detected; reconnecting";
			update();
			stream?.close();
			connect(runId, state.lastSeq);
		});
		stream.onerror = () => {
			if (state.status === "done" || state.status === "failed") {
				return;
			}
			errorMessage = "stream interrupted; browser retry active";
			update();
		};
	};

	fileInput.addEventListener("change", () => {
		uploaded = Array.from(fileInput.files ?? []).map((file) => ({
			name: file.name,
			sha256: "",
		}));
		update();
	});

	form.addEventListener("change", (event) => {
		const target = event.target;
		if (
			target instanceof HTMLInputElement &&
			target.name === "scope" &&
			(target.value === "me" ||
				target.value === "team" ||
				target.value === "org")
		) {
			scope = target.value;
		}
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		submitting = true;
		errorMessage = "";
		state = initialRunViewState;
		update();

		try {
			const files = Array.from(fileInput.files ?? []);
			const attachments: UploadedAttachment[] = [];
			for (const file of files) {
				const body = new FormData();
				body.set("file", file);
				const response = await deps.fetchImpl("/artifacts", {
					method: "POST",
					body,
				});
				if (!response.ok) {
					throw new Error("attachment upload failed");
				}
				const payload = (await response.json()) as { sha256: string };
				attachments.push({ name: file.name, sha256: payload.sha256 });
			}

			uploaded = attachments;
			const runId = deps.createRunId();
			const runResponse = await deps.fetchImpl("/runs", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					runId,
					scope,
					userMsg: textarea.value,
					attachments: attachments.map((artifact) => ({
						sha256: artifact.sha256,
					})),
				}),
			});
			if (!runResponse.ok) {
				throw new Error("run start failed");
			}
			state = { ...initialRunViewState, runId, status: "running" };
			connect(runId);
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "unexpected submit error";
			state = { ...state, status: "failed" };
		} finally {
			submitting = false;
			update();
		}
	});

	update();

	return {
		destroy() {
			stream?.close();
			root.innerHTML = "";
		},
	};
}
