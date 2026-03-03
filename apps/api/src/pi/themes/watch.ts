import { watch } from "node:fs";

export type ActiveThemeWatcher = {
	close(): void;
};

export function watchActiveThemeFile(input: {
	path: string;
	onReload: () => Promise<void> | void;
	debounceMs?: number | undefined;
}): ActiveThemeWatcher {
	let pending: NodeJS.Timeout | null = null;
	const debounceMs = input.debounceMs ?? 60;
	const watcher = watch(input.path, () => {
		if (pending) {
			clearTimeout(pending);
		}
		pending = setTimeout(() => {
			pending = null;
			void input.onReload();
		}, debounceMs);
	});
	return {
		close() {
			if (pending) {
				clearTimeout(pending);
				pending = null;
			}
			watcher.close();
		},
	};
}
