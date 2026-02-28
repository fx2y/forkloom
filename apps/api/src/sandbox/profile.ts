import type {
	SandboxNetworkPolicy,
	SandboxPreviewModel,
	SandboxProfile,
	SandboxSpecModel,
} from "./ports";

export type SandboxProfilePreset = {
	profile: SandboxProfile;
	approvalRequired: boolean;
	network: SandboxNetworkPolicy;
	cpuMillicores: number;
	memoryMb: number;
	diskMb: number;
	timeoutSec: number;
	maxBytesOut: number;
};

export type SandboxConfigInput = {
	image: string;
	workdir: string;
	defaultTimeoutSec: number;
	maxBytesOut: number;
};

export const SANDBOX_PROFILE_PRESETS: Record<
	SandboxProfile,
	SandboxProfilePreset
> = {
	safe: {
		profile: "safe",
		approvalRequired: false,
		network: "off",
		cpuMillicores: 500,
		memoryMb: 512,
		diskMb: 2_048,
		timeoutSec: 900,
		maxBytesOut: 128_000,
	},
	std: {
		profile: "std",
		approvalRequired: false,
		network: "egress",
		cpuMillicores: 1_000,
		memoryMb: 1_024,
		diskMb: 4_096,
		timeoutSec: 900,
		maxBytesOut: 256_000,
	},
	priv: {
		profile: "priv",
		approvalRequired: true,
		network: "egress",
		cpuMillicores: 2_000,
		memoryMb: 2_048,
		diskMb: 8_192,
		timeoutSec: 1_800,
		maxBytesOut: 256_000,
	},
};

function toMountPreview(
	mount: SandboxSpecModel["mounts"][number],
): SandboxPreviewModel["mounts"][number] {
	return {
		source: mount.source,
		dest: mount.dest,
		mode: mount.mode,
		kind: mount.kind,
	};
}

export function createSandboxPreviewSpec(
	spec: SandboxSpecModel,
): SandboxPreviewModel {
	return {
		imageDigest: spec.imageDigest,
		profile: spec.profile,
		network: spec.network,
		containerName: spec.containerName,
		workVolume: spec.workVolume,
		workdir: spec.workdir,
		timeoutSec: spec.timeoutSec,
		maxBytesOut: spec.maxBytesOut,
		mounts: [...spec.mounts]
			.sort((left, right) =>
				`${left.kind}:${left.dest}:${left.source}`.localeCompare(
					`${right.kind}:${right.dest}:${right.source}`,
				),
			)
			.map(toMountPreview),
	};
}

export function createSandboxSpec(input: {
	runId: string;
	sandboxId: string;
	profile: SandboxProfile;
	containerName: string;
	workVolume: string;
	piHomeHostDir: string;
	piHomePath: string;
	inputMountSource: string;
	cacheMountSource: string;
	runtimeNodeModulesSource?: string | undefined;
	config: SandboxConfigInput;
	extraEnv?: Record<string, string> | undefined;
	imageDigest?: string | undefined;
}): SandboxSpecModel {
	const preset = SANDBOX_PROFILE_PRESETS[input.profile];
	const mounts: SandboxSpecModel["mounts"] = [
		{
			kind: "work",
			source: input.workVolume,
			dest: input.config.workdir,
			mode: "rw",
		},
		{
			kind: "inputs",
			source: input.inputMountSource,
			dest: "/inputs",
			mode: "ro",
		},
	];
	if (input.runtimeNodeModulesSource) {
		mounts.push({
			kind: "inputs",
			source: input.runtimeNodeModulesSource,
			dest: "/runtime/node_modules",
			mode: "ro",
		});
	}
	mounts.push({
		kind: "cache",
		source: input.cacheMountSource,
		dest: input.piHomePath,
		mode: "rw",
	});

	return {
		runId: input.runId,
		sandboxId: input.sandboxId,
		profile: input.profile,
		backend: "docker",
		imageDigest: input.imageDigest ?? input.config.image,
		containerName: input.containerName,
		workVolume: input.workVolume,
		workdir: input.config.workdir,
		piHomeHostDir: input.piHomeHostDir,
		piHomePath: input.piHomePath,
		mounts,
		env: {
			HOME: input.piHomePath,
			...(input.extraEnv ?? {}),
		},
		network: preset.network,
		cpuMillicores: preset.cpuMillicores,
		memoryMb: preset.memoryMb,
		diskMb: preset.diskMb,
		timeoutSec: Math.max(preset.timeoutSec, input.config.defaultTimeoutSec),
		maxBytesOut: Math.min(preset.maxBytesOut, input.config.maxBytesOut),
	};
}

export function needsSandboxApproval(profile: SandboxProfile): boolean {
	return SANDBOX_PROFILE_PRESETS[profile].approvalRequired;
}
