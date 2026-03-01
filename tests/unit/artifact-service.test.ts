import { Readable } from "node:stream";
import { hashBytes, hashJSON } from "@forkloom/shared";
import { describe, expect, it } from "vitest";
import type { HttpError } from "../../apps/api/src/errors";
import type {
	ArtifactModel,
	ArtifactRepo,
	ArtifactStore,
} from "../../apps/api/src/ports";
import { ArtifactService } from "../../apps/api/src/service";

function makeArtifact(sha256: string): ArtifactModel {
	return {
		sha256,
		uri: `s3://agentos/cas/${sha256.slice(0, 2)}/${sha256}`,
		mime: "text/plain",
		bytes: 3,
		createdAt: "2026-02-27T00:00:00.000Z",
		type: "raw",
		parents: [],
		meta: {},
	};
}

function inMemoryRepo(initial: ArtifactModel[] = []): ArtifactRepo {
	const map = new Map(initial.map((item) => [item.sha256, item]));
	return {
		ping: async () => true,
		getBySha256: async (sha256) => map.get(sha256) ?? null,
		insertIfAbsent: async (model) => {
			const existing = map.get(model.sha256);
			if (existing) {
				return { artifact: existing, inserted: false };
			}
			map.set(model.sha256, model);
			return { artifact: model, inserted: true };
		},
		deleteBySha256: async (sha256) => {
			map.delete(sha256);
		},
		appendLink: async (sha256, parent, metaPatch) => {
			const found = map.get(sha256);
			if (!found) {
				return null;
			}
			const parents =
				parent && !found.parents.includes(parent)
					? [...found.parents, parent]
					: found.parents;
			const next = {
				...found,
				parents,
				meta: {
					...found.meta,
					...metaPatch,
				},
			};
			map.set(sha256, next);
			return next;
		},
	};
}

function inMemoryStore(): ArtifactStore {
	const blobs = new Map<string, { body: Buffer; mime: string }>();
	return {
		ensureBucket: async () => undefined,
		putObject: async ({ sha256, body, mime }) => {
			blobs.set(sha256, { body, mime });
		},
		getObject: async (sha256) => {
			const found = blobs.get(sha256);
			if (!found) {
				throw new Error("missing object");
			}
			return { body: Readable.from(found.body), contentType: found.mime };
		},
		ping: async () => true,
	};
}

function putCountingStore() {
	let putCalls = 0;
	const store = inMemoryStore();
	return {
		store: {
			...store,
			putObject: async (input: {
				sha256: string;
				body: Buffer;
				mime: string;
			}) => {
				putCalls += 1;
				await store.putObject(input);
			},
		} satisfies ArtifactStore,
		getPutCalls: () => putCalls,
	};
}

describe("ArtifactService", () => {
	it("dedupes stable bytes", async () => {
		const repo = inMemoryRepo();
		const store = inMemoryStore();
		const service = new ArtifactService({
			repo,
			store,
			s3Bucket: "agentos",
			now: () => new Date("2026-02-27T00:00:00.000Z"),
		});

		const first = await service.putArtifact({
			body: Buffer.from("abc"),
			mime: "text/plain",
			type: "raw",
			meta: {},
		});
		const second = await service.putArtifact({
			body: Buffer.from("abc"),
			mime: "text/plain",
			type: "raw",
			meta: {},
		});

		expect(first.sha256).toBe(second.sha256);
		expect(first.uri).toBe(second.uri);
	});

	it("blocks overwrite if force is used", async () => {
		const repo = inMemoryRepo();
		const store = inMemoryStore();
		const service = new ArtifactService({
			repo,
			store,
			s3Bucket: "agentos",
		});

		await service.putArtifact({
			body: Buffer.from("abc"),
			mime: "text/plain",
			type: "raw",
			meta: {},
		});

		await expect(
			service.putArtifact({
				body: Buffer.from("abc"),
				mime: "text/plain",
				type: "raw",
				meta: {},
				force: true,
			}),
		).rejects.toMatchObject({ status: 409 } satisfies Partial<HttpError>);
	});

	it("rejects sha mismatch", async () => {
		const service = new ArtifactService({
			repo: inMemoryRepo(),
			store: inMemoryStore(),
			s3Bucket: "agentos",
		});

		await expect(
			service.putArtifact({
				body: Buffer.from("abc"),
				mime: "text/plain",
				type: "raw",
				meta: {},
				expectedSha256: "f".repeat(64),
			}),
		).rejects.toMatchObject({ status: 400 } satisfies Partial<HttpError>);
	});

	it("updates metadata only on link", async () => {
		const sha = "a".repeat(64);
		const service = new ArtifactService({
			repo: inMemoryRepo([makeArtifact(sha)]),
			store: inMemoryStore(),
			s3Bucket: "agentos",
		});

		const linked = await service.linkArtifact(sha, "b".repeat(64), {
			"ingest.note": "x",
		});
		expect(linked.parents).toContain("b".repeat(64));
		expect(linked.meta["ingest.note"]).toBe("x");
	});

	it("returns 409 on force when insert races after empty precheck", async () => {
		const sha = "b".repeat(64);
		let inserted = false;
		const raceRepo: ArtifactRepo = {
			ping: async () => true,
			getBySha256: async () => null,
			insertIfAbsent: async () => {
				if (!inserted) {
					inserted = true;
					return { artifact: makeArtifact(sha), inserted: false };
				}
				return { artifact: makeArtifact(sha), inserted: false };
			},
			deleteBySha256: async () => undefined,
			appendLink: async () => null,
		};
		const counter = putCountingStore();
		const service = new ArtifactService({
			repo: raceRepo,
			store: counter.store,
			s3Bucket: "agentos",
		});

		await expect(
			service.putArtifact({
				body: Buffer.from("abc"),
				mime: "text/plain",
				type: "raw",
				meta: {},
				force: true,
			}),
		).rejects.toMatchObject({ status: 409 } satisfies Partial<HttpError>);
		expect(counter.getPutCalls()).toBe(0);
	});

	it("rolls back inserted metadata if object write fails", async () => {
		const sha = hashBytes(Buffer.from("abc"));
		let deletedSha: string | null = null;
		const repo: ArtifactRepo = {
			ping: async () => true,
			getBySha256: async () => null,
			insertIfAbsent: async (model) => ({ artifact: model, inserted: true }),
			deleteBySha256: async (value) => {
				deletedSha = value;
			},
			appendLink: async () => null,
		};
		const service = new ArtifactService({
			repo,
			store: {
				ensureBucket: async () => undefined,
				putObject: async () => {
					throw new Error("s3 down");
				},
				getObject: async () => {
					throw new Error("unused");
				},
				ping: async () => true,
			},
			s3Bucket: "agentos",
		});

		await expect(
			service.putArtifact({
				body: Buffer.from("abc"),
				mime: "text/plain",
				type: "raw",
				meta: {},
			}),
		).rejects.toThrow("s3 down");
		expect(deletedSha).toBe(sha);
	});

	it("putJSON uses canonical hashing and dedupes key-order variants", async () => {
		const counter = putCountingStore();
		const service = new ArtifactService({
			repo: inMemoryRepo(),
			store: counter.store,
			s3Bucket: "agentos",
		});
		const firstValue = {
			z: 1,
			a: {
				b: true,
				c: [3, 2, 1],
			},
		};
		const secondValue = {
			a: {
				c: [3, 2, 1],
				b: true,
			},
			z: 1,
		};

		const first = await service.putJSON({
			value: firstValue,
			meta: { "run.id": "run-1" },
		});
		const second = await service.putJSON({
			value: secondValue,
			meta: { "run.id": "run-1" },
		});

		expect(first.sha256).toBe(hashJSON(firstValue));
		expect(second.sha256).toBe(first.sha256);
		expect(counter.getPutCalls()).toBe(1);
	});

	it("putJSON appends lineage parents via existing link path", async () => {
		const service = new ArtifactService({
			repo: inMemoryRepo(),
			store: inMemoryStore(),
			s3Bucket: "agentos",
		});

		const artifact = await service.putJSON({
			value: { ok: true },
			meta: { "run.id": "run-1" },
			parents: ["a".repeat(64), "b".repeat(64), "a".repeat(64)],
		});

		expect(artifact.parents).toEqual(["a".repeat(64), "b".repeat(64)]);
	});
});
