import { describe, expect, it } from "vitest";
import {
	SANDBOX_PROFILE_PRESETS,
	createSandboxPreviewSpec,
	createSandboxSpec,
	needsSandboxApproval,
} from "../../apps/api/src/sandbox";

describe("sandbox profiles", () => {
	it("keeps safe/std/priv as data presets with fixed approval law", () => {
		expect(SANDBOX_PROFILE_PRESETS.safe.network).toBe("off");
		expect(SANDBOX_PROFILE_PRESETS.std.network).toBe("egress");
		expect(SANDBOX_PROFILE_PRESETS.priv.approvalRequired).toBe(true);
		expect(needsSandboxApproval("safe")).toBe(false);
		expect(needsSandboxApproval("priv")).toBe(true);
	});

	it("builds deterministic preview spec from a typed sandbox spec", () => {
		const spec = createSandboxSpec({
			runId: "run-1",
			sandboxId: "sbx-1",
			profile: "safe",
			containerName: "sbx-run-1",
			workVolume: "sbx-run-1-work",
			piHomeHostDir: "/tmp/pi-home",
			piHomePath: "/pi-home",
			inputMountSource: "/tmp/inputs",
			cacheMountSource: "/tmp/cache",
			config: {
				image: "node:24-alpine",
				workdir: "/work",
				defaultTimeoutSec: 600,
				maxBytesOut: 512_000,
			},
			extraEnv: { FOO: "bar" },
		});

		const preview = createSandboxPreviewSpec(spec);

		expect(preview).toEqual({
			imageDigest: "node:24-alpine",
			profile: "safe",
			network: "off",
			containerName: "sbx-run-1",
			workVolume: "sbx-run-1-work",
			workdir: "/work",
			timeoutSec: 900,
			maxBytesOut: 128_000,
			mounts: [
				{
					source: "/tmp/cache",
					dest: "/pi-home",
					mode: "rw",
					kind: "cache",
				},
				{
					source: "/tmp/inputs",
					dest: "/inputs",
					mode: "ro",
					kind: "inputs",
				},
				{
					source: "sbx-run-1-work",
					dest: "/work",
					mode: "rw",
					kind: "work",
				},
			],
		});
		expect(spec.env).toMatchObject({ HOME: "/pi-home", FOO: "bar" });
	});
});
