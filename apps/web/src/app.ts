import { type AppDeps, browserDeps } from "./actor-client";
import { mountInboxSurface } from "./inbox-surface";
import { mountRunSurface } from "./run-surface";
import { parseStaticFragment } from "./static-html";
import "./styles.css";

export function mountApp(root: HTMLElement, deps: AppDeps = browserDeps()) {
	root.replaceChildren(parseStaticFragment(`
		<div data-inbox-surface></div>
		<div data-run-surface></div>
	`));

	const inboxRoot = root.querySelector<HTMLElement>("[data-inbox-surface]");
	const runRoot = root.querySelector<HTMLElement>("[data-run-surface]");

	if (!(inboxRoot && runRoot)) {
		throw new Error("web mount failed: missing app surfaces");
	}

	const inbox = mountInboxSurface(inboxRoot, deps);
	const run = mountRunSurface(runRoot, deps);

	return {
		destroy() {
			inbox.destroy();
			run.destroy();
			root.replaceChildren();
		},
	};
}
