import {
	type ChildProcessWithoutNullStreams,
	execFile,
	spawn,
} from "node:child_process";

export type DockerRunResult = {
	exitCode: number;
	stdout: Buffer;
	stderr: Buffer;
};

export type DockerCaptureOptions = {
	cwd?: string | undefined;
	env?: NodeJS.ProcessEnv | undefined;
	stdinText?: string | undefined;
};

export type DockerSpawnOptions = {
	cwd?: string | undefined;
	env?: NodeJS.ProcessEnv | undefined;
};

export type DockerCliDeps = {
	execFileImpl?: typeof execFile | undefined;
	spawnImpl?: typeof spawn | undefined;
};

export class DockerCli {
	private readonly execFileImpl: typeof execFile;
	private readonly spawnImpl: typeof spawn;

	constructor(deps: DockerCliDeps = {}) {
		this.execFileImpl = deps.execFileImpl ?? execFile;
		this.spawnImpl = deps.spawnImpl ?? spawn;
	}

	capture(
		args: string[],
		options: DockerCaptureOptions = {},
	): Promise<DockerRunResult> {
		return new Promise((resolvePromise, reject) => {
			const child = this.execFileImpl(
				"docker",
				args,
				{
					cwd: options.cwd,
					env: options.env,
					encoding: "buffer",
					maxBuffer: 16 * 1024 * 1024,
				},
				(error, stdout, stderr) => {
					if (error && typeof error.code !== "number") {
						reject(error);
						return;
					}
					resolvePromise({
						exitCode: typeof error?.code === "number" ? error.code : 0,
						stdout: Buffer.isBuffer(stdout)
							? stdout
							: Buffer.from(stdout ?? "", "utf8"),
						stderr: Buffer.isBuffer(stderr)
							? stderr
							: Buffer.from(stderr ?? "", "utf8"),
					});
				},
			);
			if (options.stdinText != null) {
				child.stdin?.end(options.stdinText);
			}
		});
	}

	spawn(
		args: string[],
		options: DockerSpawnOptions = {},
	): ChildProcessWithoutNullStreams {
		return this.spawnImpl("docker", args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
	}
}
