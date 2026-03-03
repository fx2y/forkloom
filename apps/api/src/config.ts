import { homedir } from "node:os";
import { delimiter, resolve } from "node:path";
import {
	SKILL_SCOPE_PRECEDENCE,
	type SkillRoot,
	type SkillScope,
} from "./skill/types";

export type AppConfig = {
	port: number;
	databaseUrl: string;
	s3Endpoint: string;
	s3Bucket: string;
	s3Region: string;
	awsAccessKeyId: string;
	awsSecretAccessKey: string;
	docOcrEndpoint: string;
	docOcrApiKey: string;
	docOcrModel: string;
	docParserVersion: string;
	docNormVersion: string;
	docLimitPdfBytes: number;
	docLimitPdfPages: number;
	docLimitImageBytes: number;
	docOcrQueueConcurrency: number;
	docOcrQueueRateLimitPerSecond: number;
	piRpcUrl: string;
	piProvider: string;
	piModel: string;
	piStrictReal: boolean;
	sandboxImage: string;
	sandboxWorkRoot: string;
	sandboxInputsRoot: string;
	sandboxPiHomeRoot: string;
	sandboxRuntimeNodeModulesRoot?: string | undefined;
	sandboxPiHomePath: string;
	sandboxDefaultTimeoutSec: number;
	sandboxMaxBytesOut: number;
	skillRoots: SkillRoot[];
	skillPrefixBytes: number;
	skillPromptMaxSkills: number;
	skillPromptMaxDescriptionChars: number;
	piGlobalSettingsPath: string;
	piProjectSettingsPath: string;
};

function must(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`missing required env: ${name}`);
	}
	return value;
}

function parsePort(value: string | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
		throw new Error(`invalid port: ${value}`);
	}
	return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
	if (value == null || value === "") {
		return fallback;
	}
	if (value === "1" || value.toLowerCase() === "true") {
		return true;
	}
	if (value === "0" || value.toLowerCase() === "false") {
		return false;
	}
	throw new Error(`invalid boolean: ${value}`);
}

function parsePositiveInt(
	value: string | undefined,
	fallback: number,
	label: string,
): number {
	if (!value) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`invalid ${label}: ${value}`);
	}
	return parsed;
}

function pickEnv(...names: string[]): string | undefined {
	for (const name of names) {
		const value = process.env[name];
		if (value && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

function mustAny(...names: string[]): string {
	const value = pickEnv(...names);
	if (!value) {
		throw new Error(`missing required env: one of ${names.join(", ")}`);
	}
	return value;
}

function parsePathList(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	return value
		.split(delimiter)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function normalizePath(path: string, cwd: string, homeDir: string): string {
	if (path.startsWith("~/")) {
		return resolve(homeDir, path.slice(2));
	}
	if (path.startsWith("/")) {
		return resolve(path);
	}
	return resolve(cwd, path);
}

function buildPiSettingsPaths(
	cwd: string,
	homeDir: string,
): {
	piGlobalSettingsPath: string;
	piProjectSettingsPath: string;
} {
	return {
		piGlobalSettingsPath: resolve(homeDir, ".pi/agent/settings.json"),
		piProjectSettingsPath: resolve(cwd, ".pi/settings.json"),
	};
}

function buildSkillRoots(cwd: string, homeDir: string): SkillRoot[] {
	const defaults: Record<SkillScope, string[]> = {
		org: [".forkloom/skills/org"],
		workspace: [".codex/skills", "skills"],
		user: ["~/.codex/skills", "~/.pi/skills", "~/.agents/skills"],
		package: ["packages/skills"],
		global: ["/etc/forkloom/skills"],
	};
	const roots: SkillRoot[] = [];
	const seen = new Set<string>();
	for (const scope of SKILL_SCOPE_PRECEDENCE) {
		const envPaths = parsePathList(
			process.env[`SKILL_ROOTS_${scope.toUpperCase()}`],
		);
		const candidates = envPaths.length > 0 ? envPaths : defaults[scope];
		for (const candidate of candidates) {
			const normalized = normalizePath(candidate, cwd, homeDir);
			const key = `${scope}:${normalized}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			roots.push({
				scope,
				path: normalized,
			});
		}
	}
	return roots;
}

export function loadConfig(): AppConfig {
	const cwd = process.cwd();
	const homeDir = homedir();
	const settingsPaths = buildPiSettingsPaths(cwd, homeDir);
	return {
		port: parsePort(process.env.PORT, 8080),
		databaseUrl: process.env.DATABASE_URL ?? must("DBOS_SYSTEM_DATABASE_URL"),
		s3Endpoint: process.env.S3_ENDPOINT ?? "http://localhost:8333",
		s3Bucket: process.env.S3_BUCKET ?? "agentos",
		s3Region: process.env.S3_REGION ?? "us-east-1",
		awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? must("S3_ACCESS_KEY"),
		awsSecretAccessKey:
			process.env.AWS_SECRET_ACCESS_KEY ?? must("S3_SECRET_KEY"),
		docOcrEndpoint:
			process.env.DOC_OCR_ENDPOINT ??
			process.env.ZAI_ENDPOINT ??
			"https://api.z.ai/api/paas/v4/layout_parsing",
		docOcrApiKey: mustAny("DOC_OCR_API_KEY", "ZAI_KEY"),
		docOcrModel: process.env.DOC_OCR_MODEL ?? "glm-ocr",
		docParserVersion: process.env.DOC_PARSER_VERSION ?? "v1",
		docNormVersion: process.env.DOC_NORM_VERSION ?? "v1",
		docLimitPdfBytes: parsePositiveInt(
			process.env.DOC_LIMIT_PDF_BYTES,
			50_000_000,
			"doc limit pdf bytes",
		),
		docLimitPdfPages: parsePositiveInt(
			process.env.DOC_LIMIT_PDF_PAGES,
			100,
			"doc limit pdf pages",
		),
		docLimitImageBytes: parsePositiveInt(
			process.env.DOC_LIMIT_IMAGE_BYTES,
			10_000_000,
			"doc limit image bytes",
		),
		docOcrQueueConcurrency: parsePositiveInt(
			process.env.DOC_OCR_QUEUE_CONCURRENCY,
			2,
			"doc ocr queue concurrency",
		),
		docOcrQueueRateLimitPerSecond: parsePositiveInt(
			process.env.DOC_OCR_QUEUE_RATE_LIMIT_PER_SECOND,
			1,
			"doc ocr queue rate limit per second",
		),
		piRpcUrl: process.env.PI_RPC_URL ?? "http://localhost:7070",
		piProvider: process.env.PI_PROVIDER ?? "github-copilot",
		piModel: process.env.PI_MODEL ?? "gpt-4.1",
		piStrictReal: parseBoolean(process.env.PI_RPC_STRICT_REAL, false),
		sandboxImage: process.env.SANDBOX_IMAGE ?? "node:24-alpine",
		sandboxWorkRoot: process.env.SANDBOX_WORK_ROOT ?? ".cache/sandbox/work",
		sandboxInputsRoot:
			process.env.SANDBOX_INPUTS_ROOT ?? ".cache/sandbox/inputs",
		sandboxPiHomeRoot:
			process.env.SANDBOX_PI_HOME_ROOT ?? ".cache/sandbox/pi-home",
		sandboxRuntimeNodeModulesRoot:
			process.env.SANDBOX_RUNTIME_NODE_MODULES_ROOT,
		sandboxPiHomePath: process.env.SANDBOX_PI_HOME_PATH ?? "/pi-home",
		sandboxDefaultTimeoutSec: parsePositiveInt(
			process.env.SANDBOX_TIMEOUT_SEC,
			900,
			"sandbox timeout",
		),
		sandboxMaxBytesOut: parsePositiveInt(
			process.env.SANDBOX_MAX_BYTES_OUT,
			256_000,
			"sandbox max bytes out",
		),
		skillRoots: buildSkillRoots(cwd, homeDir),
		skillPrefixBytes: parsePositiveInt(
			process.env.SKILL_PREFIX_BYTES,
			8_192,
			"skill prefix bytes",
		),
		skillPromptMaxSkills: parsePositiveInt(
			process.env.SKILL_PROMPT_MAX_SKILLS,
			128,
			"skill prompt max skills",
		),
		skillPromptMaxDescriptionChars: parsePositiveInt(
			process.env.SKILL_PROMPT_MAX_DESCRIPTION_CHARS,
			240,
			"skill prompt description max chars",
		),
		...settingsPaths,
	};
}
