export type AppConfig = {
	port: number;
	databaseUrl: string;
	s3Endpoint: string;
	s3Bucket: string;
	s3Region: string;
	awsAccessKeyId: string;
	awsSecretAccessKey: string;
	piRpcUrl: string;
	piProvider: string;
	piModel: string;
	piStrictReal: boolean;
	sandboxImage: string;
	sandboxWorkRoot: string;
	sandboxInputsRoot: string;
	sandboxPiHomeRoot: string;
	sandboxPiHomePath: string;
	sandboxDefaultTimeoutSec: number;
	sandboxMaxBytesOut: number;
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

export function loadConfig(): AppConfig {
	return {
		port: parsePort(process.env.PORT, 8080),
		databaseUrl: process.env.DATABASE_URL ?? must("DBOS_SYSTEM_DATABASE_URL"),
		s3Endpoint: process.env.S3_ENDPOINT ?? "http://localhost:8333",
		s3Bucket: process.env.S3_BUCKET ?? "agentos",
		s3Region: process.env.S3_REGION ?? "us-east-1",
		awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? must("S3_ACCESS_KEY"),
		awsSecretAccessKey:
			process.env.AWS_SECRET_ACCESS_KEY ?? must("S3_SECRET_KEY"),
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
	};
}
