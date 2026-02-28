import type { RunState } from "@forkloom/contracts";

export function defaultCommandKind(
	run: RunState | null,
): "prompt" | "followUp" {
	return run?.status === "running" ? "followUp" : "prompt";
}

export function canApproveRun(run: RunState | null): boolean {
	const approval = run?.approval as { state?: string } | undefined;
	return approval?.state === "pending";
}

export function canAbortRun(run: RunState | null): boolean {
	return run?.status === "running";
}

export function canSendRunText(run: RunState | null): boolean {
	if (!run) {
		return false;
	}
	return !canApproveRun(run) && run.status !== "aborted";
}
