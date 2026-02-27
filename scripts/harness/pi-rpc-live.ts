import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import readline from "node:readline";

type RpcResponse = {
	type: string;
	id?: string;
	command?: string;
	success?: boolean;
	error?: string;
	data?: Record<string, unknown>;
};

type ProviderRunConfig = {
	provider: string;
	model: string;
	homeOverride?: string;
	mode: "real" | "mock";
};

type MockServer = {
	port: number;
	close: () => Promise<void>;
};

function startMockOpenAI(): Promise<MockServer> {
	return new Promise((resolveServer) => {
		const server = createServer((req, res) => {
			if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
				res.statusCode = 404;
				res.end("not found");
				return;
			}

			let body = "";
			req.on("data", (chunk) => {
				body += chunk.toString("utf8");
			});
			req.on("end", () => {
				const parsed = JSON.parse(body) as { stream?: boolean; model?: string };
				const model = parsed.model ?? "forkloom-mock-1";

				if (parsed.stream) {
					res.writeHead(200, {
						"content-type": "text/event-stream",
						"cache-control": "no-cache",
						connection: "keep-alive",
					});

					const chunk1 = {
						id: "chatcmpl-mock",
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model,
						choices: [
							{ index: 0, delta: { content: "ok" }, finish_reason: null },
						],
					};

					const chunk2 = {
						id: "chatcmpl-mock",
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model,
						choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					};

					res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
					res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
					res.end("data: [DONE]\n\n");
					return;
				}

				const completion = {
					id: "chatcmpl-mock",
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model,
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: "ok" },
							finish_reason: "stop",
						},
					],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				};

				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify(completion));
			});
		});

		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error("failed to bind mock OpenAI server");
			}

			resolveServer({
				port: address.port,
				close: () =>
					new Promise((resolveClose, rejectClose) => {
						server.close((err) => {
							if (err) {
								rejectClose(err);
								return;
							}
							resolveClose();
						});
					}),
			});
		});
	});
}

function writePiModels(homeDir: string, port: number): void {
	const modelsPath = join(homeDir, ".pi", "agent", "models.json");
	mkdirSync(dirname(modelsPath), { recursive: true });

	const models = {
		providers: {
			"forkloom-mock": {
				baseUrl: `http://127.0.0.1:${port}/v1`,
				api: "openai-completions",
				apiKey: "forkloom",
				compat: {
					supportsUsageInStreaming: false,
					maxTokensField: "max_tokens",
				},
				models: [{ id: "forkloom-mock-1" }],
			},
		},
	};

	writeFileSync(modelsPath, `${JSON.stringify(models, null, 2)}\n`, "utf8");
}

async function runPiRpc(
	config: ProviderRunConfig,
): Promise<{ sessionFile: string; lines: number }> {
	const responses = new Map<string, RpcResponse>();
	let stateSessionFile = "";

	const piBin = resolve("node_modules", ".bin", "pi");
	const pi = spawn(
		piBin,
		["--mode", "rpc", "--provider", config.provider, "--model", config.model],
		{
			env: {
				...process.env,
				...(config.homeOverride ? { HOME: config.homeOverride } : {}),
			},
			stdio: ["pipe", "pipe", "pipe"],
		},
	);

	const rl = readline.createInterface({ input: pi.stdout });
	rl.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) {
			return;
		}

		const msg = JSON.parse(trimmed) as RpcResponse;
		if (msg.type === "response" && msg.id) {
			responses.set(msg.id, msg);
			if (msg.command === "get_state" && msg.success) {
				const sessionFile = msg.data?.sessionFile;
				if (typeof sessionFile === "string") {
					stateSessionFile = sessionFile;
				}
			}
		}
	});

	const waitResponse = async (id: string): Promise<RpcResponse> => {
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			const found = responses.get(id);
			if (found) {
				return found;
			}
			await new Promise((resolveSleep) => setTimeout(resolveSleep, 50));
		}
		throw new Error(`timeout waiting response: ${id}`);
	};

	const send = (payload: Record<string, unknown>): void => {
		pi.stdin.write(`${JSON.stringify(payload)}\n`);
	};

	const cleanup = async (): Promise<void> => {
		if (!pi.killed) {
			pi.kill("SIGTERM");
		}
		await new Promise((resolveExit) =>
			pi.once("exit", () => resolveExit(undefined)),
		);
	};

	try {
		send({ id: "state-1", type: "get_state" });
		const state1 = await waitResponse("state-1");
		if (!state1.success) {
			throw new Error(`initial get_state failed: ${state1.error ?? "unknown"}`);
		}

		send({ id: "prompt-1", type: "prompt", message: "reply with one token" });
		await new Promise((resolveSleep) => setTimeout(resolveSleep, 150));
		send({
			id: "prompt-2",
			type: "prompt",
			message: "interrupt now",
			streamingBehavior: "steer",
		});
		send({ id: "follow-1", type: "follow_up", message: "after that, done" });

		for (const id of ["prompt-1", "prompt-2", "follow-1"]) {
			const resp = await waitResponse(id);
			if (!resp.success) {
				throw new Error(`${id} failed: ${resp.error ?? "unknown"}`);
			}
		}

		send({ id: "state-2", type: "get_state" });
		const state2 = await waitResponse("state-2");
		if (!state2.success) {
			throw new Error(`final get_state failed: ${state2.error ?? "unknown"}`);
		}

		send({ id: "abort-1", type: "abort" });
		const abortResp = await waitResponse("abort-1");
		if (!abortResp.success) {
			throw new Error(`abort failed: ${abortResp.error ?? "unknown"}`);
		}
	} finally {
		await cleanup();
	}

	if (!stateSessionFile) {
		throw new Error("pi state did not return sessionFile");
	}

	const rawSession = readFileSync(stateSessionFile, "utf8");
	return {
		sessionFile: stateSessionFile,
		lines: rawSession.trim().split(/\r?\n/).length,
	};
}

async function run(): Promise<void> {
	const defaultProvider = process.env.PI_PROVIDER ?? "github-copilot";
	const defaultModel = process.env.PI_MODEL ?? "gpt-4.1";
	const strictReal = process.env.PI_RPC_STRICT_REAL === "1";

	let result: { sessionFile: string; lines: number; mode: "real" | "mock" };

	try {
		const real = await runPiRpc({
			provider: defaultProvider,
			model: defaultModel,
			mode: "real",
		});
		result = { ...real, mode: "real" };
	} catch (realError) {
		if (strictReal) {
			throw realError;
		}

		const mock = await startMockOpenAI();
		const homeDir = resolve(tmpdir(), `forkloom-pi-home-${Date.now()}`);
		writePiModels(homeDir, mock.port);
		try {
			const mockResult = await runPiRpc({
				provider: "forkloom-mock",
				model: "forkloom-mock/forkloom-mock-1",
				homeOverride: homeDir,
				mode: "mock",
			});
			result = { ...mockResult, mode: "mock" };
		} finally {
			await mock.close();
		}
	}

	const outPath = resolve(".cache/test-int/pi-live.json");
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

run().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
