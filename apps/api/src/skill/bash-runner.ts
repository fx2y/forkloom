import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { dedupeSorted, resolveSkillPath, toSkillRelativePath } from "./paths";

export type SkillScriptOutputFile = {
	path: string;
	body: Buffer;
};

export type SkillScriptRunResult = {
	scriptPath: string;
	args: string[];
	status: "done" | "failed" | "aborted";
	exitCode: number;
	stdout: string;
	stderr: string;
	stdoutBytes: number;
	stderrBytes: number;
	startedAt: string;
	endedAt: string;
	outputFiles: SkillScriptOutputFile[];
};

export async function runSkillScript(input: {
	skillPath: string;
	scriptPath: string;
	args: string[];
	timeoutMs?: number | undefined;
	maxBytesOut?: number | undefined;
}): Promise<SkillScriptRunResult> {
	const skillDir = dirname(input.skillPath);
	const scriptRelative = normalizeScriptPath(skillDir, input.scriptPath);
	const maxBytesOut = Math.max(1, input.maxBytesOut ?? 256_000);
	const startedAt = new globalThis.Date().toISOString();

	let stdoutTail = Buffer.alloc(0);
	let stderrTail = Buffer.alloc(0);
	let stdoutBytes = 0;
	let stderrBytes = 0;
	let timedOut = false;

	const command = `bash ${quoteShell(`./${scriptRelative}`)} "$@"`;
	const child = spawn("bash", ["-lc", command, "skill-script", ...input.args], {
		cwd: skillDir,
		stdio: ["ignore", "pipe", "pipe"],
	});

	const timeoutMs = input.timeoutMs ?? 120_000;
	const timer =
		timeoutMs > 0
			? setTimeout(() => {
					timedOut = true;
					child.kill("SIGKILL");
				}, timeoutMs)
			: null;

	child.stdout.on("data", (chunk: Uint8Array) => {
		stdoutBytes += chunk.byteLength;
		stdoutTail = retainTail(stdoutTail, chunk, maxBytesOut);
	});
	child.stderr.on("data", (chunk: Uint8Array) => {
		stderrBytes += chunk.byteLength;
		stderrTail = retainTail(stderrTail, chunk, maxBytesOut);
	});

	const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
		child.once("error", rejectExit);
		child.once("close", (code) => resolveExit(code ?? 1));
	});
	if (timer) {
		clearTimeout(timer);
	}
	const endedAt = new globalThis.Date().toISOString();
	const outputFiles = await listOutputFiles(skillDir);
	const status =
		timedOut || exitCode === 137
			? "aborted"
			: exitCode === 0
				? "done"
				: "failed";

	return {
		scriptPath: scriptRelative,
		args: [...input.args],
		status,
		exitCode,
		stdout: stdoutTail.toString("utf8"),
		stderr: stderrTail.toString("utf8"),
		stdoutBytes,
		stderrBytes,
		startedAt,
		endedAt,
		outputFiles,
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

function retainTail(
	current: Buffer,
	chunk: Uint8Array,
	maxBytesOut: number,
): Buffer {
	const appended = Buffer.concat([current, Buffer.from(chunk)]);
	if (appended.length <= maxBytesOut) {
		return appended;
	}
	return appended.subarray(appended.length - maxBytesOut);
}

async function listOutputFiles(
	skillDir: string,
): Promise<SkillScriptOutputFile[]> {
	const outDir = resolve(skillDir, "out");
	if (!(await isDirectory(outDir))) {
		return [];
	}
	const files: string[] = [];
	await walkFiles(outDir, files);
	const sorted = dedupeSorted(files);
	const output: SkillScriptOutputFile[] = [];
	for (const file of sorted) {
		const relative = toSkillRelativePath(skillDir, file);
		if (!relative) {
			continue;
		}
		output.push({
			path: relative,
			body: await readFile(file),
		});
	}
	return output;
}

async function walkFiles(dirPath: string, out: string[]): Promise<void> {
	let entries: Awaited<ReturnType<typeof readdir>> = [];
	try {
		entries = await readdir(dirPath, { withFileTypes: true });
	} catch {
		return;
	}
	entries.sort((left, right) => left.name.localeCompare(right.name));
	for (const entry of entries) {
		const abs = resolve(dirPath, entry.name);
		if (entry.isDirectory()) {
			await walkFiles(abs, out);
			continue;
		}
		if (entry.isFile()) {
			out.push(abs);
		}
	}
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

function quoteShell(value: string): string {
	return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}
