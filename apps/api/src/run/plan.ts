import { resolve } from "node:path";
import {
	createSandboxPreviewSpec,
	createSandboxSpec,
	type RunCommandKind,
	type SandboxPreviewModel,
	type SandboxSpecModel,
} from "../sandbox";
import type { AppConfig } from "../config";
import type { RunSpecModel } from "./ports";

export type RunPlan = {
	sandboxSpec: SandboxSpecModel;
	previewSpec: SandboxPreviewModel;
	initialCommand: {
		kind: RunCommandKind;
		payload: Record<string, unknown>;
		dedupeKey: string;
	};
};

function toSandboxToken(runId: string): string {
	return runId.toLowerCase();
}

export function createRunPlan(
	spec: RunSpecModel,
	config: Pick<
		AppConfig,
		| "piModel"
		| "piProvider"
		| "sandboxDefaultTimeoutSec"
		| "sandboxImage"
		| "sandboxInputsRoot"
		| "sandboxMaxBytesOut"
		| "sandboxPiHomePath"
		| "sandboxPiHomeRoot"
	>,
): RunPlan {
	const token = toSandboxToken(spec.runId);
	const sandboxId = `sbx-${token}`;
	const sandboxSpec = createSandboxSpec({
		runId: spec.runId,
		sandboxId,
		profile: spec.profile ?? "safe",
		containerName: sandboxId,
		workVolume: `${sandboxId}-work`,
		piHomeHostDir: resolve(config.sandboxPiHomeRoot, spec.runId),
		piHomePath: config.sandboxPiHomePath,
		inputMountSource: resolve(config.sandboxInputsRoot, spec.runId),
		cacheMountSource: resolve(config.sandboxPiHomeRoot, spec.runId),
		config: {
			image: config.sandboxImage,
			workdir: "/work",
			defaultTimeoutSec: config.sandboxDefaultTimeoutSec,
			maxBytesOut: config.sandboxMaxBytesOut,
		},
		extraEnv: {
			PI_PROVIDER: config.piProvider,
			PI_MODEL: spec.modelPref ?? config.piModel,
		},
	});
	return {
		sandboxSpec,
		previewSpec: createSandboxPreviewSpec(sandboxSpec),
		initialCommand: {
			kind: "prompt",
			payload: {
				text: spec.userMsg,
			},
			dedupeKey: `init:${spec.runId}`,
		},
	};
}
