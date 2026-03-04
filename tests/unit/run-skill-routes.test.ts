import { afterAll, describe, expect, it } from "vitest";
import { buildApiRouter } from "../../apps/api/src/http/routes";
import { resolveScope } from "../../apps/api/src/http/scope";
import type { RunService } from "../../apps/api/src/run/service";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
const RUN_SCOPE_HEADERS = {
	"x-org-id": "00000000-0000-0000-0000-000000000001",
	"x-ws-id": "00000000-0000-0000-0000-000000000002",
	"x-write-scope": "ws",
} as const;

describe("run skill routes", () => {
	const app = buildApiRouter({
		artifactService: {
			putArtifact: async () => {
				throw new Error("unused");
			},
			getArtifactBytes: async () => {
				throw new Error("unused");
			},
			getArtifactMeta: async () => {
				throw new Error("unused");
			},
			linkArtifact: async () => {
				throw new Error("unused");
			},
		} as never,
		resolveScope,
		runService: {
			startRun: async () => {
				throw new Error("unused");
			},
			getRunState: async () => ({
				runId: RUN_ID,
				status: "running",
				startedAt: "2026-03-02T00:00:00.000Z",
				dbosWfId: `run:${RUN_ID}:1`,
				artifacts: [],
			}),
			listRunEvents: async () => [],
			queueCommand: async () => {
				throw new Error("unused");
			},
			listSkills: async (runId: string) => [
				{
					skillId: `${runId}:policy-qa`,
					name: "policy-qa",
					description: "Policy checks with citations",
					path: "/tmp/skills/policy-qa/SKILL.md",
					scope: "workspace",
					hidden: false,
					menuVisible: true,
					allowedTools: ["Read"],
					hash: "a".repeat(64),
				},
			],
			previewSkill: async (input: {
				skillName: string;
				args?: string | undefined;
			}) => {
				if (input.skillName === "missing") {
					return null;
				}
				return {
					skillName: input.skillName,
					description: "preview",
					scripts: ["scripts/run.sh"],
					touchedPaths: ["references/guide.md", "scripts/run.sh"],
					allowedTools: ["Read"],
					manualOnly: false,
					menuVisible: true,
				};
			},
			listFiles: async () => {
				throw new Error("unused");
			},
			exportFiles: async () => {
				throw new Error("unused");
			},
			getTruthBundle: async () => null,
			searchDocs: async () => {
				throw new Error("unused");
			},
			resolveDocSpan: async () => null,
			ingestDoc: async () => {
				throw new Error("unused");
			},
		} as unknown as RunService,
	});
	const server = app.listen(0);

	afterAll(async () => {
		await new Promise<void>((resolveClose, rejectClose) => {
			server.close((error) => {
				if (error) {
					rejectClose(error);
					return;
				}
				resolveClose();
			});
		});
	});

	it("lists run-owned skills from /runs/:runId/skills", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
			const response = await fetch(`${base}/runs/${RUN_ID}/skills`, {
				headers: RUN_SCOPE_HEADERS,
			});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			skills: [
				{
					skillId: `${RUN_ID}:policy-qa`,
					name: "policy-qa",
					description: "Policy checks with citations",
					path: "/tmp/skills/policy-qa/SKILL.md",
					scope: "workspace",
					hidden: false,
					menuVisible: true,
					allowedTools: ["Read"],
				},
			],
		});
	});

	it("returns read-only run preview from /runs/:runId/skills/preview", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
			const response = await fetch(`${base}/runs/${RUN_ID}/skills/preview`, {
				method: "POST",
				headers: {
					...RUN_SCOPE_HEADERS,
					"content-type": "application/json",
				},
				body: JSON.stringify({ skillName: "policy-qa", args: "region=us" }),
			});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			skillName: "policy-qa",
			description: "preview",
			scripts: ["scripts/run.sh"],
			touchedPaths: ["references/guide.md", "scripts/run.sh"],
			allowedTools: ["Read"],
			manualOnly: false,
			menuVisible: true,
		});
	});

	it("returns 404 for unknown skill preview target", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
			const response = await fetch(`${base}/runs/${RUN_ID}/skills/preview`, {
				method: "POST",
				headers: {
					...RUN_SCOPE_HEADERS,
					"content-type": "application/json",
				},
				body: JSON.stringify({ skillName: "missing" }),
			});
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "skill not found" });
	});
});
