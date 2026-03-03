import { Readable } from "node:stream";
import { hashBytes } from "@forkloom/shared";
import { describe, expect, it } from "vitest";
import type { ArtifactModel } from "../../apps/api/src/ports";
import type { RunSpecModel } from "../../apps/api/src/run/ports";
import {
	buildRunPromptInput,
	buildRunPromptMessage,
	loadPromptImages,
} from "../../apps/api/src/workflow/prompt";

const PNG_1PX = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	"base64",
);
const PNG_SHA = hashBytes(PNG_1PX);

function makeImageArtifact(
	sha256: string,
	overrides: Partial<ArtifactModel> = {},
): ArtifactModel {
	return {
		sha256,
		uri: `s3://agentos/cas/${sha256.slice(0, 2)}/${sha256}`,
		mime: "image/png",
		bytes: PNG_1PX.byteLength,
		createdAt: "2026-02-28T00:00:00.000Z",
		type: "raw",
		parents: [],
		meta: {},
		...overrides,
	};
}

function makeTextArtifact(sha256: string): ArtifactModel {
	return makeImageArtifact(sha256, { mime: "text/plain" });
}

type StubLoader = {
	metaMap: Map<string, ArtifactModel>;
	bytesMap: Map<string, Buffer>;
};

function stubLoader(state: StubLoader) {
	return {
		getArtifactMeta: async (sha256: string) => {
			const found = state.metaMap.get(sha256);
			if (!found) throw new Error(`meta not found: ${sha256}`);
			return found;
		},
		getArtifactBytes: async (sha256: string) => {
			const found = state.bytesMap.get(sha256);
			if (!found) throw new Error(`bytes not found: ${sha256}`);
			return {
				body: Readable.from(found) as NodeJS.ReadableStream,
				contentType: state.metaMap.get(sha256)?.mime ?? null,
			};
		},
	};
}

function minSpec(overrides: Partial<RunSpecModel> = {}): RunSpecModel {
	return {
		runId: "run-1",
		scope: "me",
		userMsg: "hello",
		attachments: [],
		orgId: "org-1",
		writeTarget: "member",
		...overrides,
	};
}

describe("buildRunPromptMessage", () => {
	it("returns userMsg when no attachments or context fields", () => {
		const msg = buildRunPromptMessage(minSpec());
		expect(msg).toBe("hello");
	});

	it("appends attachmentRefs when attachments are present", () => {
		const sha = "a".repeat(64);
		const msg = buildRunPromptMessage(
			minSpec({ attachments: [{ sha256: sha }] }),
		);
		expect(msg).toContain("attachmentRefs");
		expect(msg).toContain(sha);
	});

	it("appends workdirRef when provided", () => {
		const sha = "b".repeat(64);
		const msg = buildRunPromptMessage(minSpec({ workdirRef: { sha256: sha } }));
		expect(msg).toContain("workdirRef");
		expect(msg).toContain(sha);
	});

	it("appends modelPref when provided", () => {
		const msg = buildRunPromptMessage(minSpec({ modelPref: "gpt-5" }));
		expect(msg).toContain("modelPref");
		expect(msg).toContain("gpt-5");
	});

	it("combines multiple context fields in Run context block", () => {
		const sha = "c".repeat(64);
		const msg = buildRunPromptMessage(
			minSpec({ attachments: [{ sha256: sha }], modelPref: "gpt-5" }),
		);
		expect(msg).toContain("Run context:");
		expect(msg).toContain("attachmentRefs");
		expect(msg).toContain("modelPref");
	});

	it("injects available_skills XML before run context when provided", () => {
		const msg = buildRunPromptMessage(minSpec({ modelPref: "gpt-5" }), {
			availableSkillsXml:
				"<available_skills><skill><name>policy-qa</name></skill></available_skills>",
		});
		expect(msg).toContain("<available_skills>");
		expect(msg.indexOf("<available_skills>")).toBeLessThan(
			msg.indexOf("Run context:"),
		);
	});
});

describe("loadPromptImages", () => {
	it("returns empty array when no attachments", async () => {
		const loader = stubLoader({ metaMap: new Map(), bytesMap: new Map() });
		const images = await loadPromptImages(minSpec(), loader);
		expect(images).toHaveLength(0);
	});

	it("skips non-image attachments", async () => {
		const sha = hashBytes(Buffer.from("text content"));
		const meta = makeTextArtifact(sha);
		const loader = stubLoader({
			metaMap: new Map([[sha, meta]]),
			bytesMap: new Map([[sha, Buffer.from("text content")]]),
		});
		const images = await loadPromptImages(
			minSpec({ attachments: [{ sha256: sha }] }),
			loader,
		);
		expect(images).toHaveLength(0);
	});

	it("returns base64 image for image/png attachments", async () => {
		const loader = stubLoader({
			metaMap: new Map([[PNG_SHA, makeImageArtifact(PNG_SHA)]]),
			bytesMap: new Map([[PNG_SHA, PNG_1PX]]),
		});
		const images = await loadPromptImages(
			minSpec({ attachments: [{ sha256: PNG_SHA }] }),
			loader,
		);
		expect(images).toHaveLength(1);
		expect(images[0]?.type).toBe("image");
		expect(images[0]?.mimeType).toBe("image/png");
		expect(images[0]?.data).toBe(PNG_1PX.toString("base64"));
	});

	it("uses contentType over meta.mime when available", async () => {
		const loader = {
			getArtifactMeta: async (_sha256: string) => makeImageArtifact(PNG_SHA),
			getArtifactBytes: async (_sha256: string) => ({
				body: Readable.from(PNG_1PX) as NodeJS.ReadableStream,
				contentType: "image/webp",
			}),
		};
		const images = await loadPromptImages(
			minSpec({ attachments: [{ sha256: PNG_SHA }] }),
			loader,
		);
		expect(images[0]?.mimeType).toBe("image/webp");
	});
});

describe("buildRunPromptInput", () => {
	it("builds prompt input with no images for text-only attachments", async () => {
		const sha = hashBytes(Buffer.from("text"));
		const loader = stubLoader({
			metaMap: new Map([[sha, makeTextArtifact(sha)]]),
			bytesMap: new Map([[sha, Buffer.from("text")]]),
		});
		const input = await buildRunPromptInput(
			minSpec({ attachments: [{ sha256: sha }] }),
			loader,
		);
		expect(input.images).toBeUndefined();
		expect(input.message).toContain("attachmentRefs");
	});

	it("includes images when image attachments are present", async () => {
		const loader = stubLoader({
			metaMap: new Map([[PNG_SHA, makeImageArtifact(PNG_SHA)]]),
			bytesMap: new Map([[PNG_SHA, PNG_1PX]]),
		});
		const input = await buildRunPromptInput(
			minSpec({ attachments: [{ sha256: PNG_SHA }] }),
			loader,
		);
		expect(input.images).toHaveLength(1);
		expect(input.message).toContain("attachmentRefs");
	});
});
