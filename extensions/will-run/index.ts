import { createBranchStateLog, type ExtensionApi } from "../../apps/api/src/pi";

function isRiskyToolCall(toolName: string, input: Record<string, unknown>): boolean {
	if (toolName === "skill_exec") {
		const scripts = Array.isArray(input.scripts)
			? input.scripts.filter((entry): entry is string => typeof entry === "string")
			: [];
		return scripts.some((script) =>
			/(^|\s)(rm\s+-rf|sudo|chmod\s+777|curl\s+.+\|\s*sh)\b/.test(script),
		);
	}
	if (toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		return /(^|\s)(rm\s+-rf|sudo|chmod\s+777|curl\s+.+\|\s*sh)\b/.test(command);
	}
	if (toolName === "write" || toolName === "edit") {
		const path = typeof input.path === "string" ? input.path : "";
		return /(^|\/)node_modules\//.test(path) || /\.env(\.|$)/.test(path);
	}
	return false;
}

export default function registerWillRunExtension(api: ExtensionApi): void {
	const branchState = createBranchStateLog({
		api,
		key: "will-run-gate",
		initial: { blocked: 0, confirmed: 0 },
	});

	const restore = (payload: {
		branchEntries?: Array<{ ts: string; value: unknown }> | undefined;
	}) => {
		branchState.handleSessionEvent(payload);
	};

	api.on("session_start", restore);
	api.on("session_tree", restore);
	api.on("session_fork", restore);

	api.on("tool_call", async (event) => {
		if (!isRiskyToolCall(event.toolName, event.input)) {
			return;
		}
		if (!api.hasUI) {
			const next = branchState.get();
			branchState.set({ ...next, blocked: next.blocked + 1 });
			return { block: true, reason: "headless-risk-denied" };
		}
		const ok = await api.ui.confirm(`WILL RUN: ${event.toolName}`);
		const next = branchState.get();
		if (!ok) {
			branchState.set({ ...next, blocked: next.blocked + 1 });
			return { block: true, reason: "denied" };
		}
		branchState.set({ ...next, confirmed: next.confirmed + 1 });
		return;
	});
}
