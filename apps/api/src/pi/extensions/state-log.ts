import type {
	ExtensionApi,
	ExtensionHookPayloadMap,
	ExtensionStateEntry,
} from "./types";

const ENTRY_KIND = "ext-state";

type StateEnvelope<T> = {
	kind: typeof ENTRY_KIND;
	key: string;
	value: T;
};

function asStateEnvelope<T>(value: unknown, key: string): StateEnvelope<T> | null {
	if (value == null || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (record.kind !== ENTRY_KIND || record.key !== key) {
		return null;
	}
	return {
		kind: ENTRY_KIND,
		key,
		value: record.value as T,
	};
}

function restoreFromEntries<T>(entries: ExtensionStateEntry[], key: string): T | null {
	let last: T | null = null;
	for (const entry of entries) {
		const parsed = asStateEnvelope<T>(entry.value, key);
		if (parsed) {
			last = parsed.value;
		}
	}
	return last;
}

export function createBranchStateLog<T>(input: {
	api: ExtensionApi;
	key: string;
	initial: T;
}): {
	get(): T;
	set(next: T): T;
	handleSessionEvent(
		payload:
			| ExtensionHookPayloadMap["session_start"]
			| ExtensionHookPayloadMap["session_tree"]
			| ExtensionHookPayloadMap["session_fork"],
	): void;
} {
	let state = input.initial;
	return {
		get() {
			return state;
		},
		set(next) {
			state = next;
			input.api.appendEntry({
				kind: ENTRY_KIND,
				key: input.key,
				value: next,
			});
			return state;
		},
		handleSessionEvent(payload) {
			const restored = restoreFromEntries<T>(payload.branchEntries ?? [], input.key);
			if (restored != null) {
				state = restored;
			}
		},
	};
}
