import type { RunEvent, RunState } from "@forkloom/contracts";
import {
	type AppDeps,
	type EventSourceLike,
	type UploadedAttachment,
	browserDeps,
	uploadAttachments,
} from "./actor-client";
import {
	buildRunEventsUrl,
	createRun,
	exportRunFiles,
	fetchRun,
	fetchRunFiles,
	parseRunEvent,
	postRunCommand,
} from "./run-client";
import {
	canAbortRun,
	canApproveRun,
	canSendRunText,
	defaultCommandKind,
} from "./run-compose";
import {
	type RunArtifactView,
	hydrateRunState,
	initialRunViewState,
	reduceRunEvent,
} from "./state/run-reducer";
import { parseStaticFragment } from "./static-html";

const RUN_EVENT_KINDS = [
	"run_started",
	"run_previewed",
	"run_approval_required",
	"run_approved",
	"run_command_queued",
	"pi_event",
	"artifact_written",
	"workspace_updated",
	"run_aborted",
	"run_done",
	"run_failed",
] as const;

type PendingRunStream = {
	runId: string;
	stream: EventSourceLike;
};

function appendExportArtifact(
	artifacts: RunArtifactView[],
	sha256: string,
): RunArtifactView[] {
	return artifacts.some((artifact) => artifact.key === `export:${sha256}`)
		? artifacts
		: [
				...artifacts,
				{
					key: `export:${sha256}`,
					label: sha256.slice(0, 12),
					kind: "workspace_export",
					href: `/artifacts/${sha256}`,
				},
			];
}

function prettyPreview(run: RunState): string {
	const preview = run.preview as Record<string, unknown> | undefined;
	if (!preview) {
		return "No WILL-RUN preview yet.";
	}
	const profile = String(preview.profile ?? "unknown");
	const network = String(preview.network ?? "unknown");
	const workdir = String(preview.workdir ?? "/work");
	const timeoutSec = String(preview.timeoutSec ?? "?");
	const maxBytesOut = String(preview.maxBytesOut ?? "?");
	return `WILL-RUN ${profile} / ${network}\nworkdir ${workdir}\ntimeout ${timeoutSec}s / cap ${maxBytesOut}b`;
}

export function mountRunSurface(
	root: HTMLElement,
	deps: AppDeps = browserDeps(),
) {
	let state = initialRunViewState;
	let creating = false;
	let sending = false;
	let errorMessage = "";
	let uploaded: UploadedAttachment[] = [];
	let activeStream: PendingRunStream | null = null;

	root.replaceChildren(parseStaticFragment(`
		<section class="run-lab">
			<div class="panel run-panel">
				<div class="panel-head">
					<div>
						<p class="section-label">Run Lab</p>
						<h2>WILL-RUN, files, and live control</h2>
					</div>
					<span class="status" data-run-status data-state="idle">idle</span>
				</div>
				<p class="hint">This surface only renders controls that map to real <code>/runs*</code> paths. Preview and files are re-fetched from durable state, not guessed.</p>
				<p class="error" data-run-error hidden></p>
				<form class="run-form" data-run-create-form>
					<label class="field">
						<span>Run ID</span>
						<input data-run-id-input type="text" name="runId" placeholder="01HS7Z6E5R4W6NED8MH4D9Y6A0" autocomplete="off" />
					</label>
					<label class="field">
						<span>Profile</span>
						<select data-run-profile name="profile">
							<option value="safe">safe</option>
							<option value="std">std</option>
							<option value="priv">priv</option>
						</select>
					</label>
					<label class="field run-form-wide">
						<span>Prompt</span>
						<textarea data-run-prompt-input name="prompt" rows="4" placeholder="Describe the task for the sandbox run."></textarea>
					</label>
					<label class="field">
						<span>Attachments</span>
						<input data-run-file-input name="attachments" type="file" multiple />
					</label>
					<div class="run-actions">
						<button type="submit" data-run-create>${"Start run"}</button>
					</div>
				</form>
				<div class="upload-list" data-run-uploads></div>
				<p class="thread-preview" data-run-preview>No WILL-RUN preview yet.</p>
				<div class="artifact-strip" data-run-artifacts></div>
				<div class="run-grid">
					<div class="panel run-subpanel">
						<p class="section-label">Files</p>
						<ul class="file-list" data-run-files></ul>
					</div>
					<div class="panel run-subpanel">
						<details class="trace-panel" open>
							<summary data-run-trace-summary>Trace 0</summary>
							<ol class="trace-list" data-run-trace></ol>
						</details>
					</div>
				</div>
				<form class="composer" data-run-command-form>
					<label class="field">
						<span>Control text</span>
						<textarea data-run-command-input name="commandText" rows="4" placeholder="Use prompt, follow-up, or steer text here."></textarea>
					</label>
					<div class="actions run-actions">
						<button type="submit" data-run-send>Queue prompt</button>
						<button type="button" class="secondary" data-run-steer>Steer</button>
						<button type="button" class="secondary" data-run-approve>Approve</button>
						<button type="button" class="warning" data-run-abort>Abort</button>
						<button type="button" class="secondary" data-run-export>Export files</button>
					</div>
				</form>
			</div>
		</section>
	`));

	const createForm = root.querySelector<HTMLFormElement>(
		"[data-run-create-form]",
	);
	const runIdInput = root.querySelector<HTMLInputElement>(
		"[data-run-id-input]",
	);
	const runProfile =
		root.querySelector<HTMLSelectElement>("[data-run-profile]");
	const promptInput = root.querySelector<HTMLTextAreaElement>(
		"[data-run-prompt-input]",
	);
	const fileInput = root.querySelector<HTMLInputElement>(
		"[data-run-file-input]",
	);
	const uploadsNode = root.querySelector<HTMLElement>("[data-run-uploads]");
	const errorNode = root.querySelector<HTMLElement>("[data-run-error]");
	const statusNode = root.querySelector<HTMLElement>("[data-run-status]");
	const previewNode = root.querySelector<HTMLElement>("[data-run-preview]");
	const artifactsNode = root.querySelector<HTMLElement>("[data-run-artifacts]");
	const filesNode = root.querySelector<HTMLUListElement>("[data-run-files]");
	const traceSummaryNode = root.querySelector<HTMLElement>(
		"[data-run-trace-summary]",
	);
	const traceNode = root.querySelector<HTMLOListElement>("[data-run-trace]");
	const commandForm = root.querySelector<HTMLFormElement>(
		"[data-run-command-form]",
	);
	const commandInput = root.querySelector<HTMLTextAreaElement>(
		"[data-run-command-input]",
	);
	const createButton =
		root.querySelector<HTMLButtonElement>("[data-run-create]");
	const sendButton = root.querySelector<HTMLButtonElement>("[data-run-send]");
	const steerButton = root.querySelector<HTMLButtonElement>("[data-run-steer]");
	const approveButton =
		root.querySelector<HTMLButtonElement>("[data-run-approve]");
	const abortButton = root.querySelector<HTMLButtonElement>("[data-run-abort]");
	const exportButton =
		root.querySelector<HTMLButtonElement>("[data-run-export]");

	if (
		!(
			createForm &&
			runIdInput &&
			runProfile &&
			promptInput &&
			fileInput &&
			uploadsNode &&
			errorNode &&
			statusNode &&
			previewNode &&
			artifactsNode &&
			filesNode &&
			traceSummaryNode &&
			traceNode &&
			commandForm &&
			commandInput &&
			createButton &&
			sendButton &&
			steerButton &&
			approveButton &&
			abortButton &&
			exportButton
		)
	) {
		throw new Error("web mount failed: missing run nodes");
	}

	const closeActiveStream = () => {
		activeStream?.stream.close();
		activeStream = null;
	};

	const clearNode = (node: Element) => {
		node.replaceChildren();
	};

	const appendCode = (parent: Element, value: string) => {
		const code = document.createElement("code");
		code.textContent = value;
		parent.append(code);
	};

	const renderArtifacts = () => {
		clearNode(artifactsNode);
		for (const artifact of state.artifacts) {
			const chip = artifact.href
				? document.createElement("a")
				: document.createElement("span");
			chip.className = artifact.href ? "chip chip-link" : "chip";
			if (chip instanceof HTMLAnchorElement && artifact.href) {
				chip.href = artifact.href;
				chip.target = "_blank";
				chip.rel = "noreferrer";
			}
			chip.append(artifact.kind);
			appendCode(chip, artifact.label);
			artifactsNode.append(chip);
		}
	};

	const renderFiles = () => {
		clearNode(filesNode);
		const files = (
			state.run?.files as
				| { entries?: Array<{ path: string; bytes: number }> }
				| undefined
		)?.entries;
		if (!files || files.length === 0) {
			const empty = document.createElement("li");
			empty.className = "hint";
			empty.textContent = "No durable files yet.";
			filesNode.append(empty);
			return;
		}
		for (const entry of files) {
			const item = document.createElement("li");
			item.className = "file-item";
			const label = document.createElement("span");
			label.textContent = entry.path;
			const meta = document.createElement("code");
			meta.textContent = `${entry.bytes}b`;
			item.append(label, meta);
			filesNode.append(item);
		}
	};

	const renderTrace = () => {
		clearNode(traceNode);
		for (const entry of state.trace) {
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
		traceSummaryNode.textContent = `Trace ${state.trace.length}`;
	};

	const renderUploads = () => {
		clearNode(uploadsNode);
		for (const artifact of uploaded) {
			const chip = document.createElement("span");
			chip.className = "chip";
			chip.append(artifact.name);
			if (artifact.sha256) {
				appendCode(chip, artifact.sha256.slice(0, 10));
			}
			uploadsNode.append(chip);
		}
	};

		const update = () => {
			const run = state.run;
			const status = run?.status ?? "idle";
			const sendKind = defaultCommandKind(run);
			const canExport =
				((run?.files as { workspaceRef?: { sha256: string } } | undefined)
					?.workspaceRef?.sha256?.length ?? 0) > 0;
			errorNode.hidden = errorMessage.length === 0;
		errorNode.textContent = errorMessage;
		statusNode.textContent = status;
		statusNode.dataset.state = status;
		previewNode.textContent = run
			? prettyPreview(run)
			: "No WILL-RUN preview yet.";
		renderArtifacts();
		renderFiles();
		renderTrace();
		renderUploads();

		createButton.disabled = creating;
		createButton.textContent = creating ? "Starting..." : "Start run";
		sendButton.disabled = sending || !canSendRunText(run);
		sendButton.textContent = `Queue ${sendKind}`;
		steerButton.disabled =
			sending || !canSendRunText(run) || run?.status !== "running";
		approveButton.disabled = sending || !canApproveRun(run);
		abortButton.disabled = sending || !canAbortRun(run);
			exportButton.disabled = sending || !canExport;
		commandInput.disabled = sending || run == null;
	};

	const refreshRunFiles = async (runId: string) => {
		if (!state.run) {
			return;
		}
		const files = await fetchRunFiles(deps, runId);
		state = hydrateRunState(state, {
			...state.run,
			files: {
				workspaceRef: files.workspaceRef,
				entries: files.workspace_manifest.entries,
			},
		});
		update();
	};

	const connectRun = (runId: string) => {
		if (activeStream?.runId === runId) {
			return;
		}
		closeActiveStream();
		const stream = deps.createEventSource(
			buildRunEventsUrl(runId, state.lastEventSeq),
		);
		activeStream = { runId, stream };

		for (const kind of RUN_EVENT_KINDS) {
			stream.addEventListener(kind, (message) => {
				const event = parseRunEvent(message);
				state = reduceRunEvent(state, event);
				update();
				if (event.kind === "workspace_updated") {
					void refreshRunFiles(runId).catch(() => undefined);
				}
			});
		}

		stream.addEventListener("gap", (message) => {
			const payload = JSON.parse(message.data) as {
				reconnectFrom?: number;
			};
			errorMessage = "run stream gap detected; reconnecting";
			if (typeof payload.reconnectFrom === "number") {
				state = {
					...state,
					lastEventSeq: payload.reconnectFrom,
				};
			}
			update();
			closeActiveStream();
			connectRun(runId);
		});

		stream.onerror = () => {
			errorMessage = "run stream interrupted; browser retry active";
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

	createForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		const runId = runIdInput.value.trim();
		const prompt = promptInput.value.trim();
		if (!runId || !prompt) {
			errorMessage = "run id and prompt are required";
			update();
			return;
		}

		try {
			creating = true;
			errorMessage = "";
			update();
			const uploadedFiles = await uploadAttachments(
				deps.fetchImpl,
				Array.from(fileInput.files ?? []),
			);
			uploaded = uploadedFiles;
			await createRun(deps, {
				runId,
				scope: "team",
				userMsg: prompt,
				attachments: uploadedFiles.map(({ sha256 }) => ({ sha256 })),
				profile: runProfile.value as "safe" | "std" | "priv",
			});
			state = hydrateRunState(initialRunViewState, await fetchRun(deps, runId));
			connectRun(runId);
			await refreshRunFiles(runId);
			fileInput.value = "";
			uploaded = [];
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "run create failed";
		} finally {
			creating = false;
			update();
		}
	});

	commandForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (!state.run) {
			return;
		}
		const text = commandInput.value.trim();
		const kind = defaultCommandKind(state.run);
		if (!text) {
			errorMessage = "command text is required";
			update();
			return;
		}
		try {
			sending = true;
			errorMessage = "";
			update();
			await postRunCommand(deps, state.run.runId, {
				kind,
				payload: { text },
			});
			commandInput.value = "";
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "run command failed";
		} finally {
			sending = false;
			update();
		}
	});

	steerButton.addEventListener("click", async () => {
		if (!state.run) {
			return;
		}
		const text = commandInput.value.trim();
		if (!text) {
			errorMessage = "command text is required";
			update();
			return;
		}
		try {
			sending = true;
			errorMessage = "";
			update();
			await postRunCommand(deps, state.run.runId, {
				kind: "steer",
				payload: { text },
			});
			commandInput.value = "";
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "run steer failed";
		} finally {
			sending = false;
			update();
		}
	});

	approveButton.addEventListener("click", async () => {
		if (!state.run) {
			return;
		}
		try {
			sending = true;
			errorMessage = "";
			update();
			await postRunCommand(deps, state.run.runId, {
				kind: "approve",
			});
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "run approve failed";
		} finally {
			sending = false;
			update();
		}
	});

	abortButton.addEventListener("click", async () => {
		if (!state.run) {
			return;
		}
		try {
			sending = true;
			errorMessage = "";
			update();
			await postRunCommand(deps, state.run.runId, {
				kind: "abort",
			});
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "run abort failed";
		} finally {
			sending = false;
			update();
		}
	});

	exportButton.addEventListener("click", async () => {
		if (!state.run) {
			return;
		}
		const runId = state.run.runId;
		try {
			sending = true;
			errorMessage = "";
			update();
			const exported = await exportRunFiles(deps, runId);
			state = {
				...state,
				artifacts: appendExportArtifact(
					state.artifacts,
					exported.workspace_export.sha256,
				),
			};
			await refreshRunFiles(runId);
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "run export failed";
		} finally {
			sending = false;
			update();
		}
	});

	update();

	return {
		destroy() {
			closeActiveStream();
			root.replaceChildren();
		},
	};
}
