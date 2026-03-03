import {
	createBranchStateLog,
	type ExtensionApi,
	type ExtensionHookPayloadMap,
} from "../../apps/api/src/pi";

const REQUIRED_KEYS = ["client", "deadline"] as const;

function parseExistingValues(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of REQUIRED_KEYS) {
		const match = text.match(new RegExp(`${key}\\s*:\\s*([^\\n]+)`, "i"));
		if (match?.[1]) {
			out[key] = match[1].trim();
		}
	}
	return out;
}

function sortedJson(value: Record<string, string>): string {
	const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
	const out: Record<string, string> = {};
	for (const key of keys) {
		out[key] = value[key] as string;
	}
	return JSON.stringify(out);
}

export default function registerStructuredWizard(api: ExtensionApi): undefined {
	const branchState = createBranchStateLog({
		api,
		key: "structured-wizard",
		initial: { answers: {} as Record<string, string> },
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

	api.on("before_agent_start", async (event) => {
		const existing = parseExistingValues(event.text);
		const missing = REQUIRED_KEYS.filter((key) => !existing[key]);
		if (missing.length === 0) {
			return undefined;
		}
		if (!api.hasUI) {
			return undefined;
		}
		const answers: Record<string, string> = { ...existing };
		for (const key of missing) {
			const value = await api.ui.input(`Missing ${key}`);
			if (typeof value === "string" && value.trim().length > 0) {
				answers[key] = value.trim();
			}
		}
		branchState.set({ answers });
		return {
			text: `${event.text}\n[form:${sortedJson(answers)}]`,
		};
	});
	return undefined;
}
