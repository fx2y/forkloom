import { describe, expect, it, vi } from "vitest";
import type { AppDeps } from "./actor-client";
import {
	fetchRunSkills,
	postRunDocIngest,
	postRunDocResolve,
	postRunDocSearch,
	postRunSkillPreview,
} from "./run-client";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";

describe("run-client doc methods", () => {
	it("posts search payloads to run-owned doc routes", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => {
			return new Response(
				JSON.stringify({
					query: "invoice",
					scope: "*",
					hits: [],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		const deps: AppDeps = {
			fetchImpl,
			createEventSource: () =>
				({
					addEventListener() {
						return;
					},
					close() {
						return;
					},
					onerror: null,
				}) as never,
		};
		const result = await postRunDocSearch(deps, RUN_ID, {
			query: "invoice",
			scope: "*",
		});
		expect(result.hits).toEqual([]);
		expect(fetchImpl).toHaveBeenCalledWith(`/runs/${RUN_ID}/doc/search`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				query: "invoice",
				scope: "*",
			}),
		});
	});

	it("returns null when resolve route responds 404", async () => {
		const deps: AppDeps = {
			fetchImpl: vi.fn<typeof fetch>(async () => {
				return new Response(JSON.stringify({ error: "span not found" }), {
					status: 404,
					headers: { "content-type": "application/json" },
				});
			}),
			createEventSource: () =>
				({
					addEventListener() {
						return;
					},
					close() {
						return;
					},
					onerror: null,
				}) as never,
		};
		const resolved = await postRunDocResolve(deps, RUN_ID, {
			docSha: "a".repeat(64),
			parseId: "parse:1",
			page: 1,
			bbox: [0, 0, 100, 100],
			charStart: 0,
			charEnd: 8,
			blockPath: "p1/b1",
			chunkId: "chunk:1",
		});
		expect(resolved).toBeNull();
	});

	it("posts ingest payloads to run-owned doc ingest route", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => {
			return new Response(
				JSON.stringify({
					docSha: "a".repeat(64),
					parseId: "parse:1",
					status: "queued",
				}),
				{
					status: 202,
					headers: { "content-type": "application/json" },
				},
			);
		});
		const deps: AppDeps = {
			fetchImpl,
			createEventSource: () =>
				({
					addEventListener() {
						return;
					},
					close() {
						return;
					},
					onerror: null,
				}) as never,
		};
		const input = {
			mime: "application/pdf",
			bodyBase64: Buffer.from("pdf", "utf8").toString("base64"),
		};
		const result = await postRunDocIngest(deps, RUN_ID, input);
		expect(result.status).toBe("queued");
		expect(fetchImpl).toHaveBeenCalledWith(`/runs/${RUN_ID}/doc/ingest`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		});
	});

	it("fetches run-owned skills list", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => {
			return new Response(
				JSON.stringify({
					skills: [
						{
							skillId: "policy-qa",
							name: "policy-qa",
							description: "Policy checks",
							path: "/skills/policy-qa/SKILL.md",
							scope: "workspace",
							hidden: false,
							menuVisible: true,
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		const deps: AppDeps = {
			fetchImpl,
			createEventSource: () =>
				({
					addEventListener() {
						return;
					},
					close() {
						return;
					},
					onerror: null,
				}) as never,
		};
		const out = await fetchRunSkills(deps, RUN_ID);
		expect(out.skills[0]?.name).toBe("policy-qa");
		expect(fetchImpl).toHaveBeenCalledWith(`/runs/${RUN_ID}/skills`);
	});

	it("returns null on 404 skill preview route", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => {
			return new Response(JSON.stringify({ error: "skill not found" }), {
				status: 404,
				headers: { "content-type": "application/json" },
			});
		});
		const deps: AppDeps = {
			fetchImpl,
			createEventSource: () =>
				({
					addEventListener() {
						return;
					},
					close() {
						return;
					},
					onerror: null,
				}) as never,
		};
		const out = await postRunSkillPreview(deps, RUN_ID, {
			skillName: "missing",
		});
		expect(out).toBeNull();
		expect(fetchImpl).toHaveBeenCalledWith(`/runs/${RUN_ID}/skills/preview`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ skillName: "missing" }),
		});
	});
});
