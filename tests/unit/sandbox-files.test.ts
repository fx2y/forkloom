import { once } from "node:events";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { hashBytes } from "@forkloom/shared";
import { describe, expect, it } from "vitest";
import {
	exportWorkspaceFiles,
	listWorkspaceFiles,
} from "../../apps/api/src/sandbox/files";

function writeString(target: Buffer<ArrayBufferLike>, start: number, value: string) {
	Buffer.from(value, "utf8").copy(target, start);
}

function writeOctal(
	target: Buffer<ArrayBufferLike>,
	start: number,
	length: number,
	value: number,
) {
	const field = `${value.toString(8).padStart(length - 1, "0")}\0`;
	writeString(target, start, field);
}

function buildTarHeader(
	path: string,
	body: Buffer<ArrayBufferLike>,
): Buffer<ArrayBufferLike> {
	const header = Buffer.alloc(512, 0);
	writeString(header, 0, path);
	writeOctal(header, 100, 8, 0o644);
	writeOctal(header, 108, 8, 0);
	writeOctal(header, 116, 8, 0);
	writeOctal(header, 124, 12, body.byteLength);
	writeOctal(header, 136, 12, 0);
	header[156] = "0".charCodeAt(0);
	writeString(header, 257, "ustar");
	writeString(header, 263, "00");
	for (let index = 148; index < 156; index += 1) {
		header[index] = 32;
	}
	let checksum = 0;
	for (const byte of header) {
		checksum += byte;
	}
	writeString(header, 148, `${checksum.toString(8).padStart(6, "0")}\0 `);
	return header;
}

async function gzipBytes(
	body: Buffer<ArrayBufferLike>,
): Promise<Buffer<ArrayBufferLike>> {
	const gzip = createGzip();
	const chunks: Uint8Array[] = [];
	gzip.on("data", (chunk: Uint8Array) => {
		chunks.push(Buffer.from(chunk));
	});
	gzip.end(body);
	await once(gzip, "end");
	return Buffer.concat(chunks);
}

async function buildArchive(files: Record<string, string>) {
	const parts: Buffer<ArrayBufferLike>[] = [];
	for (const [path, text] of Object.entries(files)) {
		const body = Buffer.from(text);
		parts.push(buildTarHeader(path, body));
		parts.push(body);
		const remainder = body.byteLength % 512;
		if (remainder !== 0) {
			parts.push(Buffer.alloc(512 - remainder, 0));
		}
	}
	parts.push(Buffer.alloc(1024, 0));
	return gzipBytes(Buffer.concat(parts));
}

describe("workspace files", () => {
	it("lists durable files from the snapshot artifact", async () => {
		const archive = await buildArchive({
			"project/keep.txt": "keep",
			"node_modules/drop.txt": "drop",
		});
		const listed = await listWorkspaceFiles({
			workspaceRef: { sha256: hashBytes(archive) },
			artifactService: {
				getArtifactBytes: async () => ({
					body: Readable.from([archive]),
					contentType: "application/gzip",
				}),
				putArtifact: async () => {
					throw new Error("not used");
				},
			},
		});

		expect(listed.workspace_manifest.entries).toHaveLength(1);
		expect(listed.workspace_manifest.entries[0]?.path).toBe("project/keep.txt");
	});

	it("exports a filtered tarball back into CAS", async () => {
		const archive = await buildArchive({
			"project/keep.txt": "keep",
			"project/other.txt": "other",
		});
		let stored: Buffer<ArrayBufferLike> | null = null;
		const exported = await exportWorkspaceFiles({
			runId: "run-1",
			workspaceRef: { sha256: hashBytes(archive) },
			paths: ["project/other.txt"],
			artifactService: {
				getArtifactBytes: async () => ({
					body: Readable.from([archive]),
					contentType: "application/gzip",
				}),
				putArtifact: async (input) => {
					stored = input.body;
					return {
						sha256: hashBytes(input.body),
						uri: "s3://bucket/export",
						mime: input.mime,
						bytes: input.body.byteLength,
						type: input.type,
						createdAt: new Date(0).toISOString(),
						parents: [],
						meta: input.meta,
					};
				},
			},
		});

		expect(stored).not.toBeNull();
		expect(exported.workspace_manifest.entries.map((entry) => entry.path)).toEqual([
			"project/other.txt",
		]);
	});
});
