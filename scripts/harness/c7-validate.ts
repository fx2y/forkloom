import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { writeJson } from "./live-support";

type SandboxSseProof = {
	runId: string;
	replayKinds: string[];
	stayedOpenAfterTerminal: boolean;
};

type SandboxFunctionalProof = {
	runId: string;
	sessionFileExists: boolean;
	sessionLogKinds: string[];
};

type SkillsLiveProof = {
	status: string;
	runId: string;
	skillExecStepCount: number;
};

type C7ValidateReport = {
	status: "ok" | "fail";
	generatedAt: string;
	booleans: {
		ext_ok: boolean;
		pkg_ok: boolean;
		theme_ok: boolean;
		ux_ok: boolean;
		headless_ok: boolean;
		stream_ok: boolean;
		sandbox_ok: boolean;
	};
	evidence: {
		streamingIntPath: string;
		sandboxIntPath: string;
		skillsLivePath: string;
		flagshipProofPath: string;
		packageProofPath: string;
		themeProofPath: string;
		uxProofPath: string;
		streamRunId: string;
		sandboxRunId: string;
		headlessRunId: string;
	};
};

async function readJson<T>(path: string): Promise<T> {
	const raw = await readFile(path, "utf8");
	return JSON.parse(raw) as T;
}

async function readOptionalJson(
	path: string,
): Promise<Record<string, unknown> | null> {
	try {
		return await readJson<Record<string, unknown>>(path);
	} catch {
		return null;
	}
}

export async function buildC7ValidateReport(
	outputPath = ".cache/spec09/c7-validate.json",
): Promise<C7ValidateReport> {
	const streamingIntPath = ".cache/spec09/cy7-streaming.int.json";
	const sandboxIntPath = ".cache/spec09/cy7-sandbox.int.json";
	const skillsLivePath = ".cache/spec08/skills-live-proof.json";
	const flagshipProofPath = ".cache/spec09/cy6-flagship-proof.json";
	const packageProofPath = ".cache/spec09/cy3-pkg-proof.json";
	const themeProofPath = ".cache/spec09/cy5-theme-proof.json";
	const uxProofPath = ".cache/spec09/cy7-client.e2e.json";

	const streamProof = await readJson<SandboxSseProof>(streamingIntPath);
	const sandboxProof = await readJson<SandboxFunctionalProof>(sandboxIntPath);
	const skillsLiveProof = await readJson<SkillsLiveProof>(skillsLivePath);
	const flagshipProof = await readOptionalJson(flagshipProofPath);
	const packageProof = await readOptionalJson(packageProofPath);
	const themeProof = await readOptionalJson(themeProofPath);
	const uxProof = await readOptionalJson(uxProofPath);

	const streamOk =
		streamProof.stayedOpenAfterTerminal === true &&
		Array.isArray(streamProof.replayKinds) &&
		streamProof.replayKinds.includes("run_aborted");
	const sandboxOk =
		sandboxProof.sessionFileExists === true &&
		Array.isArray(sandboxProof.sessionLogKinds) &&
		sandboxProof.sessionLogKinds.includes("steer") &&
		sandboxProof.sessionLogKinds.includes("follow_up");
	const headlessOk =
		skillsLiveProof.status === "ok" &&
		typeof skillsLiveProof.skillExecStepCount === "number" &&
		skillsLiveProof.skillExecStepCount >= 1;

	const extChecks = flagshipProof?.checks as
		| Record<string, unknown>
		| undefined;
	const themeChecks = themeProof?.checks as Record<string, unknown> | undefined;
	const extOk =
		extChecks?.scope_guard_mark === "green" && extChecks?.unit_mark === "green";
	const pkgOk =
		packageProof?.unit_mark === true && packageProof?.contract_mark === true;
	const themeOk =
		themeChecks?.scope_guard_mark === "green" &&
		themeChecks?.unit_mark === "green";
	const uxOk = uxProof?.status === "ok";

	const booleans = {
		ext_ok: extOk,
		pkg_ok: pkgOk,
		theme_ok: themeOk,
		ux_ok: uxOk,
		headless_ok: headlessOk,
		stream_ok: streamOk,
		sandbox_ok: sandboxOk,
	};

	const status = Object.values(booleans).every(Boolean) ? "ok" : "fail";
	const report: C7ValidateReport = {
		status,
		generatedAt: new Date().toISOString(),
		booleans,
		evidence: {
			streamingIntPath,
			sandboxIntPath,
			skillsLivePath,
			flagshipProofPath,
			packageProofPath,
			themeProofPath,
			uxProofPath,
			streamRunId: streamProof.runId,
			sandboxRunId: sandboxProof.runId,
			headlessRunId: skillsLiveProof.runId,
		},
	};

	await writeJson(outputPath, report as unknown as Record<string, unknown>);
	if (status !== "ok") {
		throw new Error(`c7-validate fail: ${JSON.stringify(booleans)}`);
	}
	return report;
}

async function main(): Promise<void> {
	const outputPath = process.argv[2] ?? ".cache/spec09/c7-validate.json";
	const report = await buildC7ValidateReport(outputPath);
	console.log(
		`c7-validate ${report.status}: ${JSON.stringify(report.booleans)}`,
	);
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
