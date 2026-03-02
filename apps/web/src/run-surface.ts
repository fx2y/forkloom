import type { RunState, SpanRef } from "@forkloom/contracts";
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
	fetchRunSkills,
	fetchRunTruth,
	parseRunEvent,
	postRunCommand,
	postRunDocResolve,
	postRunDocSearch,
	postRunSkillPreview,
} from "./run-client";
import {
	canAbortRun,
	canApproveRun,
	canSendRunText,
	defaultCommandKind,
} from "./run-compose";
import {
	type RunArtifactView,
	type RunProvenance,
	hydrateRunDocResolve,
	hydrateRunDocSearch,
	hydrateRunSkillPreview,
	hydrateRunSkills,
	hydrateRunState,
	hydrateRunTruth,
	initialRunViewState,
	reduceRunEvent,
	selectRunSkill,
	toSpanKey,
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

function prettySkillPreview(
	preview: {
		skillName: string;
		description: string;
		scripts: string[];
		touchedPaths: string[];
		allowedTools?: string[] | undefined;
		manualOnly: boolean;
		menuVisible: boolean;
	} | null,
): string {
	if (!preview) {
		return "No skill WILL-RUN preview yet.";
	}
	const lines = [
		`/skill:${preview.skillName}`,
		preview.description,
		`manualOnly ${preview.manualOnly ? "yes" : "no"} / menuVisible ${preview.menuVisible ? "yes" : "no"}`,
		`scripts ${preview.scripts.join(", ") || "(none)"}`,
		`touched ${preview.touchedPaths.join(", ") || "(none)"}`,
	];
	if (preview.allowedTools && preview.allowedTools.length > 0) {
		lines.push(`allowedTools ${preview.allowedTools.join(", ")}`);
	}
	return lines.join("\n");
}

function toSkillCommandText(skillName: string, args: string): string {
	const trimmedArgs = args.trim();
	return trimmedArgs.length > 0
		? `/skill:${skillName} ${trimmedArgs}`
		: `/skill:${skillName}`;
}

export function mountRunSurface(
	root: HTMLElement,
	deps: AppDeps = browserDeps(),
) {
	let state = initialRunViewState;
	let creating = false;
	let sending = false;
	let loadingSkills = false;
	let previewingSkill = false;
	let searchingDocs = false;
	let resolvingSpanKey: string | null = null;
	let errorMessage = "";
	let uploaded: UploadedAttachment[] = [];
	let activeStream: PendingRunStream | null = null;
	let selectedArtifactSha: string | null = null;
	let selectedResolvedSpanKey: string | null = null;

	root.replaceChildren(
		parseStaticFragment(`
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
							<div class="panel run-subpanel">
								<details class="trace-panel" open>
									<summary data-run-provenance-summary>Provenance</summary>
									<ul class="file-list" data-run-provenance></ul>
								</details>
							</div>
							<div class="panel run-subpanel">
								<p class="section-label">Skills</p>
								<label class="field">
									<span>Skill Picker</span>
									<input data-run-skill-name type="text" name="skillName" placeholder="policy-qa" list="run-skill-options" autocomplete="off" />
									<datalist id="run-skill-options" data-run-skill-options></datalist>
								</label>
								<label class="field">
									<span>Skill Args</span>
									<input data-run-skill-args type="text" name="skillArgs" placeholder="region=us" autocomplete="off" />
								</label>
								<div class="actions run-actions">
									<button type="button" class="secondary" data-run-skill-preview-button>Preview skill</button>
									<button type="button" class="secondary" data-run-skill-insert>/skill insert</button>
								</div>
								<ul class="file-list" data-run-skill-list></ul>
								<p class="thread-preview" data-run-skill-preview>No skill WILL-RUN preview yet.</p>
							</div>
							<div class="panel run-subpanel">
								<p class="section-label">Citations</p>
								<form class="field" data-run-doc-search-form>
									<label class="field">
										<span>Query</span>
										<input data-run-doc-query type="text" name="query" placeholder="invoice total" />
									</label>
									<label class="field">
										<span>Scope</span>
										<input data-run-doc-scope type="text" name="scope" value="*" placeholder="* | doc:&lt;sha&gt; | parse:&lt;id&gt;" />
									</label>
									<button type="submit" data-run-doc-search>Search citations</button>
								</form>
								<ul class="file-list" data-run-doc-hits></ul>
								<div class="thread-preview" data-run-doc-resolve>Resolve a span to view exact markdown slice.</div>
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
	`),
	);

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
	const provenanceSummaryNode = root.querySelector<HTMLElement>(
		"[data-run-provenance-summary]",
	);
	const provenanceNode = root.querySelector<HTMLUListElement>(
		"[data-run-provenance]",
	);
	const skillNameInput = root.querySelector<HTMLInputElement>(
		"[data-run-skill-name]",
	);
	const skillArgsInput = root.querySelector<HTMLInputElement>(
		"[data-run-skill-args]",
	);
	const skillOptionsNode = root.querySelector<HTMLDataListElement>(
		"[data-run-skill-options]",
	);
	const skillListNode = root.querySelector<HTMLUListElement>(
		"[data-run-skill-list]",
	);
	const skillPreviewNode = root.querySelector<HTMLElement>(
		"[data-run-skill-preview]",
	);
	const skillPreviewButton = root.querySelector<HTMLButtonElement>(
		"[data-run-skill-preview-button]",
	);
	const skillInsertButton = root.querySelector<HTMLButtonElement>(
		"[data-run-skill-insert]",
	);
	const docSearchForm = root.querySelector<HTMLFormElement>(
		"[data-run-doc-search-form]",
	);
	const docQueryInput = root.querySelector<HTMLInputElement>(
		"[data-run-doc-query]",
	);
	const docScopeInput = root.querySelector<HTMLInputElement>(
		"[data-run-doc-scope]",
	);
	const docSearchButton = root.querySelector<HTMLButtonElement>(
		"[data-run-doc-search]",
	);
	const docHitsNode = root.querySelector<HTMLUListElement>(
		"[data-run-doc-hits]",
	);
	const docResolveNode = root.querySelector<HTMLElement>(
		"[data-run-doc-resolve]",
	);
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
			provenanceSummaryNode &&
			provenanceNode &&
			skillNameInput &&
			skillArgsInput &&
			skillOptionsNode &&
			skillListNode &&
			skillPreviewNode &&
			skillPreviewButton &&
			skillInsertButton &&
			docSearchForm &&
			docQueryInput &&
			docScopeInput &&
			docSearchButton &&
			docHitsNode &&
			docResolveNode &&
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

	const toArtifactSha = (artifact: RunArtifactView): string | null => {
		const idx = artifact.key.indexOf(":");
		if (idx < 0) {
			return null;
		}
		const sha256 = artifact.key.slice(idx + 1);
		return /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null;
	};

	const renderProvenanceRows = (artifactSha: string, rows: RunProvenance[]) => {
		clearNode(provenanceNode);
		for (const row of rows) {
			const item = document.createElement("li");
			item.className = "file-item";

			const primary = document.createElement("div");
			primary.className = "provenance-main";
			const step = document.createElement("strong");
			step.textContent = `${row.stepName}#${row.attempt}`;
			const run = document.createElement("code");
			run.textContent = row.runId;
			primary.append(step, run);

			const secondary = document.createElement("div");
			secondary.className = "provenance-links";
			const artifactLink = document.createElement("a");
			artifactLink.href = `/artifacts/${artifactSha}`;
			artifactLink.target = "_blank";
			artifactLink.rel = "noreferrer";
			artifactLink.textContent = "artifact";
			secondary.append(artifactLink);
			for (const sessionId of row.sessionIds) {
				const sessionLink = document.createElement("a");
				sessionLink.href = `/runs/${row.runId}/truth#session-${encodeURIComponent(sessionId)}`;
				sessionLink.target = "_blank";
				sessionLink.rel = "noreferrer";
				sessionLink.textContent = `session ${sessionId.slice(0, 8)}`;
				secondary.append(sessionLink);
			}
			if (row.parentShas.length > 0) {
				const parent = document.createElement("code");
				parent.textContent = `parents ${row.parentShas.map((sha) => sha.slice(0, 12)).join(",")}`;
				secondary.append(parent);
			}

			item.append(primary, secondary);
			provenanceNode.append(item);
		}
		provenanceSummaryNode.textContent = `Provenance ${rows.length}`;
	};

	const renderProvenance = () => {
		clearNode(provenanceNode);
		if (!selectedArtifactSha) {
			const empty = document.createElement("li");
			empty.className = "hint";
			empty.textContent = "Select an artifact chip to inspect provenance.";
			provenanceNode.append(empty);
			provenanceSummaryNode.textContent = "Provenance";
			return;
		}
		const rows = state.provenanceByArtifact[selectedArtifactSha] ?? [];
		if (rows.length === 0) {
			const empty = document.createElement("li");
			empty.className = "hint";
			empty.textContent = `No durable provenance rows for ${selectedArtifactSha.slice(0, 12)}.`;
			provenanceNode.append(empty);
			provenanceSummaryNode.textContent = "Provenance 0";
			return;
		}
		renderProvenanceRows(selectedArtifactSha, rows);
	};

	const renderResolvedSpan = () => {
		if (!selectedResolvedSpanKey) {
			docResolveNode.textContent =
				"Resolve a span to view exact markdown slice.";
			return;
		}
		const resolved = state.resolvedSpanByKey[selectedResolvedSpanKey];
		if (!resolved) {
			docResolveNode.textContent = "Resolved span not found in reducer state.";
			return;
		}
		const bboxTxt = resolved.bbox ? resolved.bbox.join(",") : "null";
		docResolveNode.textContent = [
			`chunk ${resolved.span.chunkId}`,
			`page ${resolved.span.page}`,
			`bbox ${bboxTxt}`,
			"",
			resolved.md,
		].join("\n");
	};

	const resolveDocSpan = async (span: SpanRef) => {
		if (!state.run) {
			return;
		}
		const key = toSpanKey(span);
		try {
			resolvingSpanKey = key;
			errorMessage = "";
			update();
			const resolved = await postRunDocResolve(deps, state.run.runId, span);
			if (!resolved) {
				errorMessage = "span not found";
				return;
			}
			state = hydrateRunDocResolve(state, resolved);
			selectedResolvedSpanKey = key;
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "doc span resolve failed";
		} finally {
			resolvingSpanKey = null;
			update();
		}
	};

	const renderDocHits = () => {
		clearNode(docHitsNode);
		const hits = state.docSearch?.hits ?? [];
		if (hits.length === 0) {
			const empty = document.createElement("li");
			empty.className = "hint";
			empty.textContent = "No citation hits yet.";
			docHitsNode.append(empty);
			return;
		}
		for (const hit of hits) {
			const item = document.createElement("li");
			item.className = "file-item";

			const summary = document.createElement("div");
			summary.className = "provenance-main";
			const chunk = document.createElement("strong");
			chunk.textContent = hit.chunkId;
			const snippet = document.createElement("span");
			snippet.textContent = hit.snippet;
			const score = document.createElement("code");
			score.textContent = `score ${hit.score.toFixed(4)}`;
			summary.append(chunk, snippet, score);

			const spanActions = document.createElement("div");
			spanActions.className = "provenance-links";
			for (const span of hit.spans) {
				const key = toSpanKey(span);
				const btn = document.createElement("button");
				btn.type = "button";
				btn.className = "secondary";
				btn.textContent =
					resolvingSpanKey === key ? "Resolving..." : `resolve p${span.page}`;
				btn.disabled = resolvingSpanKey === key || searchingDocs || !state.run;
				btn.addEventListener("click", () => {
					void resolveDocSpan(span);
				});
				spanActions.append(btn);
			}

			item.append(summary, spanActions);
			docHitsNode.append(item);
		}
	};

	const renderArtifacts = () => {
		clearNode(artifactsNode);
		for (const artifact of state.artifacts) {
			const artifactSha = toArtifactSha(artifact);
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
			if (artifactSha) {
				chip.addEventListener("click", () => {
					selectedArtifactSha = artifactSha;
					renderProvenance();
				});
			}
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

	const renderSkills = () => {
		clearNode(skillListNode);
		clearNode(skillOptionsNode);
		for (const skill of state.skills) {
			const option = document.createElement("option");
			option.value = skill.name;
			option.label = skill.description;
			skillOptionsNode.append(option);

			const row = document.createElement("li");
			row.className = "file-item";
			const left = document.createElement("div");
			left.className = "provenance-main";
			const name = document.createElement("strong");
			name.textContent = skill.name;
			const desc = document.createElement("span");
			desc.textContent = skill.description;
			const scope = document.createElement("code");
			scope.textContent = `${skill.scope}${skill.hidden ? " manual-only" : ""}${skill.menuVisible ? "" : " menu-hidden"}`;
			left.append(name, desc, scope);

			const pick = document.createElement("button");
			pick.type = "button";
			pick.className = "secondary";
			pick.textContent =
				state.selectedSkillName === skill.name ? "Selected" : "Select";
			pick.disabled = state.selectedSkillName === skill.name;
			pick.addEventListener("click", () => {
				state = selectRunSkill(state, skill.name);
				skillNameInput.value = skill.name;
				update();
			});

			row.append(left, pick);
			skillListNode.append(row);
		}
		if (state.skills.length === 0) {
			const empty = document.createElement("li");
			empty.className = "hint";
			empty.textContent = "No registered skills for this run.";
			skillListNode.append(empty);
		}

		if (state.selectedSkillName) {
			skillNameInput.value = state.selectedSkillName;
		}
		skillPreviewNode.textContent = prettySkillPreview(state.selectedSkillPreview);
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
		renderProvenance();
		renderSkills();
		renderDocHits();
		renderResolvedSpan();
		renderUploads();

		createButton.disabled = creating;
		createButton.textContent = creating ? "Starting..." : "Start run";
		docSearchButton.disabled = searchingDocs || run == null;
		docSearchButton.textContent = searchingDocs
			? "Searching..."
			: "Search citations";
		skillPreviewButton.disabled =
			previewingSkill || loadingSkills || run == null || state.skills.length === 0;
		skillPreviewButton.textContent = previewingSkill
			? "Previewing..."
			: loadingSkills
				? "Loading..."
				: "Preview skill";
		skillInsertButton.disabled = run == null || state.selectedSkillName == null;
		skillNameInput.disabled = loadingSkills || run == null;
		skillArgsInput.disabled = run == null;
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

	const refreshRunTruth = async (runId: string) => {
		const truth = await fetchRunTruth(deps, runId);
		state = hydrateRunTruth(state, truth);
		if (!selectedArtifactSha) {
			selectedArtifactSha = truth.artifacts[0]?.sha256 ?? null;
		}
		update();
	};

	const refreshRunSkills = async (runId: string) => {
		loadingSkills = true;
		update();
		try {
			const result = await fetchRunSkills(deps, runId);
			state = hydrateRunSkills(state, result.skills);
		} finally {
			loadingSkills = false;
			update();
		}
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
				if (
					event.kind === "workspace_updated" ||
					event.kind === "artifact_written" ||
					event.kind === "run_done"
				) {
					void refreshRunTruth(runId).catch(() => undefined);
				}
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
			selectedResolvedSpanKey = null;
			await refreshRunSkills(runId);
			await refreshRunTruth(runId);
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

	docSearchForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (!state.run) {
			errorMessage = "start a run before searching docs";
			update();
			return;
		}
		const query = docQueryInput.value.trim();
		const scope = docScopeInput.value.trim() || "*";
		if (!query) {
			errorMessage = "doc search query is required";
			update();
			return;
		}
		try {
			searchingDocs = true;
			errorMessage = "";
			update();
			const search = await postRunDocSearch(deps, state.run.runId, {
				query,
				scope,
				limit: 20,
			});
			state = hydrateRunDocSearch(state, search);
			selectedResolvedSpanKey = null;
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "doc search failed";
		} finally {
			searchingDocs = false;
			update();
		}
	});

	skillNameInput.addEventListener("change", () => {
		const name = skillNameInput.value.trim();
		state = selectRunSkill(state, name.length > 0 ? name : null);
		update();
	});

	skillPreviewButton.addEventListener("click", async () => {
		if (!state.run) {
			return;
		}
		const fromInput = skillNameInput.value.trim();
		const skillName =
			fromInput.length > 0 ? fromInput : state.selectedSkillName ?? "";
		if (skillName.length === 0) {
			errorMessage = "skill name is required";
			update();
			return;
		}
		if (!state.skills.some((skill) => skill.name === skillName)) {
			errorMessage = `unknown skill: ${skillName}`;
			update();
			return;
		}
		try {
			previewingSkill = true;
			errorMessage = "";
			update();
			const preview = await postRunSkillPreview(deps, state.run.runId, {
				skillName,
				args: skillArgsInput.value.trim() || undefined,
			});
			if (!preview) {
				errorMessage = `skill not found: ${skillName}`;
				return;
			}
			state = hydrateRunSkillPreview(state, preview);
			skillNameInput.value = preview.skillName;
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "skill preview failed";
		} finally {
			previewingSkill = false;
			update();
		}
	});

	skillInsertButton.addEventListener("click", () => {
		const fromInput = skillNameInput.value.trim();
		const skillName =
			fromInput.length > 0 ? fromInput : state.selectedSkillName ?? "";
		if (skillName.length === 0) {
			errorMessage = "skill name is required";
			update();
			return;
		}
		if (!state.skills.some((skill) => skill.name === skillName)) {
			errorMessage = `unknown skill: ${skillName}`;
			update();
			return;
		}
		commandInput.value = toSkillCommandText(skillName, skillArgsInput.value);
		state = selectRunSkill(state, skillName);
		errorMessage = "";
		update();
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
			await refreshRunTruth(runId);
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
