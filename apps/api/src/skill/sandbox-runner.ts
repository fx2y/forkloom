import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { ExecResult, RunnerBackend, SandboxModel } from "../sandbox";
import type { SkillScriptOutputFile, SkillScriptRunResult } from "./bash-runner";
import { resolveSkillPath, toSkillRelativePath } from "./paths";

type SandboxSkillRunnerInput = {
	skillPath: string;
	scriptPath: string;
	args: string[];
	timeoutMs?: number | undefined;
	maxBytesOut?: number | undefined;
};

type SandboxSkillRunnerFactoryInput = {
	backend: RunnerBackend;
	sandbox: SandboxModel;
	runId: string;
	commandSeq: number;
};

type SkillFilePayload = {
	relativePath: string;
	base64: string;
};

const SKILL_STAGE_ROOT = ".skills";

export function createSandboxSkillRunner(
	input: SandboxSkillRunnerFactoryInput,
): (run: SandboxSkillRunnerInput) => Promise<SkillScriptRunResult> {
	return async (run) => {
		const skillDir = dirname(run.skillPath);
		const scriptRelative = normalizeScriptPath(skillDir, run.scriptPath);
		const stageToken = toStageToken(run.skillPath);
		const containerSkillWorkDir = toContainerSkillDir(
			input.runId,
			input.commandSeq,
			stageToken,
			input.sandbox.spec.workdir,
		);
		const filePayloads = await collectSkillFilePayloads(skillDir);
		const timeoutSec = Math.max(
			1,
			Math.ceil((run.timeoutMs ?? input.sandbox.spec.timeoutSec * 1_000) / 1_000),
		);
		const maxBytesOut = Math.max(1, run.maxBytesOut ?? input.sandbox.spec.maxBytesOut);
		const exec = await input.backend.exec(input.sandbox, {
			cmd: buildScriptExecCommand({
				containerSkillWorkDir,
				scriptRelative,
				args: run.args,
				filePayloads,
			}),
			cwd: input.sandbox.spec.workdir,
			stream: false,
			timeoutSec,
			maxBytesOut,
		});
		const outputFiles =
			exec.status === "done"
				? await listOutputFiles(input, containerSkillWorkDir, maxBytesOut, timeoutSec)
				: [];
		return {
			scriptPath: scriptRelative,
			args: [...run.args],
			status: toRunStatus(exec),
			exitCode: exec.exitCode,
			stdout: exec.stdoutTail,
			stderr: exec.stderrTail,
			stdoutBytes: exec.stdoutBytes,
			stderrBytes: exec.stderrBytes,
			startedAt: exec.startedAt,
			endedAt: exec.endedAt,
			outputFiles,
		};
	};
}

function normalizeScriptPath(skillDir: string, scriptPath: string): string {
	const absolute = resolveSkillPath(skillDir, scriptPath);
	const relative = toSkillRelativePath(skillDir, absolute);
	if (!relative || !relative.startsWith("scripts/")) {
		throw new Error(`script path must stay under scripts/: ${scriptPath}`);
	}
	return relative;
}

function toStageToken(skillPath: string): string {
	const base = basename(dirname(skillPath)).toLowerCase();
	const clean = base.replace(/[^a-z0-9-]/g, "-");
	return clean.length > 0 ? clean : "skill";
}

function toContainerSkillDir(
	runId: string,
	commandSeq: number,
	stageToken: string,
	root: string,
): string {
	return [root, SKILL_STAGE_ROOT, runId, String(commandSeq), stageToken].join("/");
}

async function collectSkillFilePayloads(
	skillDir: string,
): Promise<SkillFilePayload[]> {
	const files: string[] = [];
	await walkSkillFiles(skillDir, files);
	const payloads: SkillFilePayload[] = [];
	for (const absolutePath of files.sort((left, right) => left.localeCompare(right))) {
		const relativePath = toSkillRelativePath(skillDir, absolutePath);
		if (!relativePath) {
			continue;
		}
		const body = await readFile(absolutePath);
		payloads.push({
			relativePath,
			base64: body.toString("base64"),
		});
	}
	return payloads;
}

async function walkSkillFiles(dirPath: string, out: string[]): Promise<void> {
	let entries: Awaited<ReturnType<typeof readdir>> = [];
	try {
		entries = await readdir(dirPath, { withFileTypes: true });
	} catch {
		return;
	}
	entries.sort((left, right) => left.name.localeCompare(right.name));
	for (const entry of entries) {
		const absolutePath = resolve(dirPath, entry.name);
		if (entry.isDirectory()) {
			await walkSkillFiles(absolutePath, out);
			continue;
		}
		if (entry.isSymbolicLink()) {
			throw new Error(`skill file symlink is not supported: ${absolutePath}`);
		}
		if (entry.isFile()) {
			out.push(absolutePath);
		}
	}
}

function buildScriptExecCommand(input: {
	containerSkillWorkDir: string;
	scriptRelative: string;
	args: string[];
	filePayloads: SkillFilePayload[];
}): string[] {
	const setupCommands: string[] = [
		"set -eu",
		`dst=${quoteShell(input.containerSkillWorkDir)}`,
		'rm -rf "$dst"',
		'mkdir -p "$dst"',
	];
	for (const payload of input.filePayloads) {
		const targetPath = `${input.containerSkillWorkDir}/${payload.relativePath}`;
		const parentPath = dirname(targetPath);
		setupCommands.push(`mkdir -p ${quoteShell(parentPath)}`);
		setupCommands.push(
			`printf '%s' ${quoteShell(payload.base64)} | base64 -d > ${quoteShell(targetPath)}`,
		);
	}
	setupCommands.push('chmod -R u+rwX "$dst"');
	setupCommands.push('cd "$dst"');
	setupCommands.push('runner="$(command -v bash || command -v sh)"');
	setupCommands.push(`"$runner" ${quoteShell(`./${input.scriptRelative}`)} "$@"`);
	return ["sh", "-lc", setupCommands.join("; "), "skill-script", ...input.args];
}

async function listOutputFiles(
	input: SandboxSkillRunnerFactoryInput,
	containerSkillWorkDir: string,
	maxBytesOut: number,
	timeoutSec: number,
): Promise<SkillScriptOutputFile[]> {
	const listed = await input.backend.exec(input.sandbox, {
		cmd: ["sh", "-lc", "if [ -d out ]; then find out -type f | LC_ALL=C sort; fi"],
		cwd: containerSkillWorkDir,
		stream: false,
		timeoutSec,
		maxBytesOut,
	});
	if (listed.status !== "done") {
		return [];
	}
	const paths = listed.stdoutTail
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const files: SkillScriptOutputFile[] = [];
	for (const relativePath of paths) {
		const body = await readOutputFile({
			input,
			cwd: containerSkillWorkDir,
			relativePath,
			maxBytesOut,
			timeoutSec,
		});
		files.push({
			path: relativePath.replaceAll("\\", "/"),
			body,
		});
	}
	return files;
}

async function readOutputFile(input: {
	input: SandboxSkillRunnerFactoryInput;
	cwd: string;
	relativePath: string;
	maxBytesOut: number;
	timeoutSec: number;
}): Promise<Buffer> {
	const read = await input.input.backend.exec(input.input.sandbox, {
		cmd: [
			"sh",
			"-lc",
			'base64 "$1" | tr -d "\\n"',
			"read-skill-out",
			input.relativePath,
		],
		cwd: input.cwd,
		stream: false,
		timeoutSec: input.timeoutSec,
		maxBytesOut: input.maxBytesOut,
	});
	if (read.status !== "done") {
		throw new Error(`failed to read skill output file: ${input.relativePath}`);
	}
	if (read.stdoutBytes > read.maxBytesOut) {
		throw new Error(
			`skill output file exceeds maxBytesOut budget: ${input.relativePath}`,
		);
	}
	try {
		return Buffer.from(read.stdoutTail.trim(), "base64");
	} catch (error) {
		throw new Error(
			`failed to decode skill output file ${input.relativePath}: ${String(error)}`,
		);
	}
}

function quoteShell(value: string): string {
	return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function toRunStatus(result: ExecResult): SkillScriptRunResult["status"] {
	switch (result.status) {
		case "done":
			return "done";
		case "aborted":
			return "aborted";
		case "failed":
		case "running":
			return "failed";
	}
}
