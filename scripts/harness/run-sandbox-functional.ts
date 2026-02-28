import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DockerBackend,
	createSandboxPiSessionFactory,
	createSandboxSpec,
} from "../../apps/api/src/sandbox";
import { writeJson } from "./live-support";

const PROOF_PATH = ".cache/test-int/run-sandbox-functional.json";

const MOCK_PI_RPC_SCRIPT = `
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import readline from "node:readline";

const home = process.env.HOME ?? "/pi-home";
const sessionFile = join(home, ".pi", "agent", "sessions", "mock.jsonl");
mkdirSync(dirname(sessionFile), { recursive: true });

let isStreaming = false;
let pending = 0;
let lastAssistantText = "sandbox ok";

function append(type, payload) {
  appendFileSync(
    sessionFile,
    JSON.stringify({
      type,
      payload,
      timestamp: new Date().toISOString(),
    }) + "\\n",
    "utf8",
  );
}

function respond(id, data = {}) {
  process.stdout.write(JSON.stringify({
    type: "response",
    id,
    success: true,
    data,
  }) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  const msg = JSON.parse(line);
  switch (msg.type) {
    case "get_state":
      respond(msg.id, {
        sessionFile,
        sessionId: "sandbox-session-1",
        isStreaming,
        pending,
      });
      return;
    case "prompt":
      isStreaming = true;
      pending = 1;
      append("prompt", {
        message: msg.message,
        streamingBehavior: msg.streamingBehavior ?? null,
      });
      process.stdout.write(JSON.stringify({
        type: "agent_event",
        kind: "prompt_started",
      }) + "\\n");
      isStreaming = false;
      pending = 0;
      respond(msg.id, {});
      return;
    case "steer":
      append("steer", { message: msg.message });
      respond(msg.id, {});
      return;
    case "follow_up":
      append("follow_up", { message: msg.message });
      respond(msg.id, {});
      return;
    case "abort":
      append("abort", {});
      isStreaming = false;
      pending = 0;
      respond(msg.id, {});
      return;
    case "get_last_assistant_text":
      respond(msg.id, { text: lastAssistantText });
      return;
    case "get_session_stats":
      respond(msg.id, { totalTokens: 4, toolCalls: 1 });
      return;
    default:
      respond(msg.id, {});
  }
});
`;

async function prepareSourceHome(root: string): Promise<string> {
	const homeDir = join(root, "source-home");
	await mkdir(join(homeDir, ".pi", "agent"), { recursive: true });
	await writeFile(join(homeDir, ".pi", "agent", "auth.json"), "{}\n", "utf8");
	await writeFile(
		join(homeDir, ".pi", "agent", "settings.json"),
		"{}\n",
		"utf8",
	);
	await writeFile(join(homeDir, ".pi", "agent", "models.json"), "{}\n", "utf8");
	return homeDir;
}

async function main(): Promise<void> {
	const tempRoot = await mkdtemp(join(tmpdir(), "forkloom-sandbox-live-"));
	const runId = `sandbox-live-${Date.now()}`;
	const sandboxId = `sbx-${runId}`;
	const inputsDir = join(tempRoot, "inputs");
	const piHomeHostDir = join(tempRoot, "pi-home");
	const sourceHome = await prepareSourceHome(tempRoot);
	await mkdir(inputsDir, { recursive: true });
	await mkdir(piHomeHostDir, { recursive: true });
	await writeFile(
		join(inputsDir, "mock-pi-rpc.mjs"),
		MOCK_PI_RPC_SCRIPT,
		"utf8",
	);

	const backend = new DockerBackend();
	const spec = createSandboxSpec({
		runId,
		sandboxId,
		profile: "safe",
		containerName: sandboxId,
		workVolume: `${sandboxId}-work`,
		piHomeHostDir,
		piHomePath: "/pi-home",
		inputMountSource: inputsDir,
		cacheMountSource: piHomeHostDir,
		config: {
			image: "node:24-alpine",
			workdir: "/work",
			defaultTimeoutSec: 900,
			maxBytesOut: 256_000,
		},
	});

	let sandbox = await backend.ensureSandbox(spec);
	try {
		await backend.exec(sandbox, {
			cmd: [
				"node",
				"-e",
				"require('node:fs').writeFileSync('/work/proof.txt','sandbox-persist')",
			],
			cwd: "/work",
			stream: true,
			timeoutSec: 30,
			maxBytesOut: 16_384,
		});

		sandbox = await backend.sleepSandbox(sandbox);
		sandbox = await backend.ensureSandbox(spec);
		const postWake = await backend.exec(sandbox, {
			cmd: [
				"node",
				"-e",
				"process.stdout.write(require('node:fs').readFileSync('/work/proof.txt','utf8'))",
			],
			cwd: "/work",
			stream: true,
			timeoutSec: 30,
			maxBytesOut: 16_384,
		});

		sandbox = await backend.recreateSandbox(sandbox);
		const postRecreate = await backend.exec(sandbox, {
			cmd: [
				"node",
				"-e",
				"process.stdout.write(require('node:fs').readFileSync('/work/proof.txt','utf8'))",
			],
			cwd: "/work",
			stream: true,
			timeoutSec: 30,
			maxBytesOut: 16_384,
		});

		const createSession = createSandboxPiSessionFactory(
			{
				containerName: sandbox.containerName,
				cwd: "/work",
				homeHostDir: piHomeHostDir,
				homePath: "/pi-home",
				provider: "forkloom-mock",
				model: "forkloom-mock-1",
				piCommand: ["node", "/inputs/mock-pi-rpc.mjs"],
			},
			{ sourceHome },
		);
		const session = await createSession();
		try {
			const state = await session.getState();
			await session.prompt({ message: "write proof" });
			await session.steer("switch plan");
			await session.followUp("finish cleanly");
			await session.abort();
			const assistantText = await session.getLastAssistantText();
			const stats = await session.getSessionStats();
			await session.close();

			const sessionLog = (await readFile(state.sessionFile, "utf8"))
				.trim()
				.split("\n")
				.filter((line) => line.length > 0)
				.map((line) => JSON.parse(line) as { type: string });

			await writeJson(PROOF_PATH, {
				runId,
				sandboxId,
				postWakeText: postWake.stdoutTail,
				postRecreateText: postRecreate.stdoutTail,
				sessionFile: state.sessionFile,
				sessionFileExists: true,
				sessionLogKinds: sessionLog.map((entry) => entry.type),
				assistantText,
				stats,
			});
		} finally {
			await session.close().catch(() => undefined);
		}
	} finally {
		await backend.destroySandbox(sandbox, "delete").catch(() => undefined);
		await rm(tempRoot, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
