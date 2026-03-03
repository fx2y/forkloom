import {
	createBranchStateLog,
	type ExtensionApi,
	type ExtensionHookPayloadMap,
} from "../../apps/api/src/pi";

function artifactPointer(result: Record<string, unknown>): string | null {
	const details = result.details;
	if (details == null || typeof details !== "object") {
		return null;
	}
	const sha = (details as Record<string, unknown>).artifactSha;
	return typeof sha === "string" && sha.length > 0 ? sha : null;
}

export default function registerArtifactWidgetExtension(
	api: ExtensionApi,
): undefined {
	const branchState = createBranchStateLog({
		api,
		key: "artifact-widget",
		initial: { lastArtifactSha: "", updates: 0 },
	});

	const restore = async (
		payload:
			| ExtensionHookPayloadMap["session_start"]
			| ExtensionHookPayloadMap["session_tree"]
			| ExtensionHookPayloadMap["session_fork"],
	): Promise<undefined> => {
		branchState.handleSessionEvent(payload);
		return undefined;
	};

	api.on("session_start", restore);
	api.on("session_tree", restore);
	api.on("session_fork", restore);

	api.on("tool_result", async (event) => {
		const sha = artifactPointer(event.result);
		if (!sha) {
			return undefined;
		}
		const current = branchState.get();
		branchState.set({
			lastArtifactSha: sha,
			updates: current.updates + 1,
		});
		if (!api.hasUI) {
			return undefined;
		}
		api.ui.setStatus("artifact", `artifact ${sha.slice(0, 12)}`);
		api.ui.setWidget("artifact", [`sha:${sha}`]);
		return undefined;
	});
	return undefined;
}
