import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

type MockServer = {
	port: number;
	close(): Promise<void>;
};

export type MockPiProviderLease = {
	provider: string;
	model: string;
	homeOverride: string;
	release(): Promise<void>;
};

const MOCK_PROVIDER = "forkloom-mock";
const MOCK_MODEL = "forkloom-mock/forkloom-mock-1";

function startMockOpenAiServer(): Promise<MockServer> {
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
				const model = parsed.model ?? MOCK_MODEL;

				if (parsed.stream) {
					res.writeHead(200, {
						"content-type": "text/event-stream",
						"cache-control": "no-cache",
						connection: "keep-alive",
					});
					res.write(
						`data: ${JSON.stringify({
							id: "chatcmpl-mock",
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model,
							choices: [
								{ index: 0, delta: { content: "ok" }, finish_reason: null },
							],
						})}\n\n`,
					);
					res.write(
						`data: ${JSON.stringify({
							id: "chatcmpl-mock",
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model,
							choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
							usage: {
								prompt_tokens: 1,
								completion_tokens: 1,
								total_tokens: 2,
							},
						})}\n\n`,
					);
					res.end("data: [DONE]\n\n");
					return;
				}

				res.setHeader("content-type", "application/json");
				res.end(
					JSON.stringify({
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
						usage: {
							prompt_tokens: 1,
							completion_tokens: 1,
							total_tokens: 2,
						},
					}),
				);
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
						server.close((error) => {
							if (error) {
								rejectClose(error);
								return;
							}
							resolveClose();
						});
					}),
			});
		});
	});
}

async function writeMockPiModels(homeDir: string, port: number): Promise<void> {
	const modelsPath = join(homeDir, ".pi", "agent", "models.json");
	await mkdir(dirname(modelsPath), { recursive: true });
	await writeFile(
		modelsPath,
		`${JSON.stringify(
			{
				providers: {
					[MOCK_PROVIDER]: {
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
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
}

export class MockPiProviderManager {
	private server: MockServer | null = null;
	private homeOverride: string | null = null;
	private refs = 0;

	async acquire(): Promise<MockPiProviderLease> {
		if (!this.server || !this.homeOverride) {
			this.server = await startMockOpenAiServer();
			this.homeOverride = join(tmpdir(), `forkloom-pi-home-${Date.now()}`);
			await writeMockPiModels(this.homeOverride, this.server.port);
		}

		this.refs += 1;
		return {
			provider: MOCK_PROVIDER,
			model: MOCK_MODEL,
			homeOverride: this.homeOverride,
			release: async () => {
				this.refs = Math.max(0, this.refs - 1);
				if (this.refs > 0) {
					return;
				}
				const server = this.server;
				const homeOverride = this.homeOverride;
				this.server = null;
				this.homeOverride = null;
				if (server) {
					await server.close();
				}
				if (homeOverride) {
					await rm(homeOverride, { recursive: true, force: true });
				}
			},
		};
	}
}
