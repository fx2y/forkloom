import { createGzip, gunzipSync } from "node:zlib";
import { once } from "node:events";
import { hashBytes } from "@forkloom/shared";
import type { ArtifactService } from "../service";
import { readArtifactBuffer } from "./input-staging";
import {
	buildWorkspaceManifest,
	filterDurableWorkspaceEntries,
	type WorkspaceFileEntry,
} from "./snapshot";

type ArtifactPointer = {
	sha256: string;
};

type ArtifactWriter = Pick<ArtifactService, "getArtifactBytes" | "putArtifact">;

type TarEntry = {
	path: string;
	body: Buffer<ArrayBufferLike>;
};

function readCString(
	buffer: Buffer<ArrayBufferLike>,
	start: number,
	length: number,
): string {
	const slice = buffer.subarray(start, start + length);
	const zeroAt = slice.indexOf(0);
	const raw = zeroAt === -1 ? slice : slice.subarray(0, zeroAt);
	return raw.toString("utf8").trim();
}

function parseOctal(
	buffer: Buffer<ArrayBufferLike>,
	start: number,
	length: number,
): number {
	const raw = readCString(buffer, start, length).replace(/\0/g, "").trim();
	if (raw.length === 0) {
		return 0;
	}
	return Number.parseInt(raw.replace(/\s+$/u, ""), 8);
}

function isZeroBlock(block: Buffer<ArrayBufferLike>): boolean {
	for (const byte of block) {
		if (byte !== 0) {
			return false;
		}
	}
	return true;
}

function formatOctal(value: number, width: number): string {
	return value.toString(8).padStart(width - 1, "0");
}

function writeString(
	target: Buffer<ArrayBufferLike>,
	start: number,
	length: number,
	value: string,
): void {
	const encoded = Buffer.from(value, "utf8");
	encoded.copy(target, start, 0, Math.min(encoded.byteLength, length));
}

function writeOctal(
	target: Buffer<ArrayBufferLike>,
	start: number,
	length: number,
	value: number,
): void {
	writeString(target, start, length - 1, formatOctal(value, length));
	target[start + length - 1] = 0;
}

function buildTarHeader(entry: TarEntry): Buffer<ArrayBufferLike> {
	const header = Buffer.alloc(512, 0);
	writeString(header, 0, 100, entry.path);
	writeOctal(header, 100, 8, 0o644);
	writeOctal(header, 108, 8, 0);
	writeOctal(header, 116, 8, 0);
	writeOctal(header, 124, 12, entry.body.byteLength);
	writeOctal(header, 136, 12, 0);
	header[156] = "0".charCodeAt(0);
	writeString(header, 257, 6, "ustar");
	writeString(header, 263, 2, "00");
	for (let index = 148; index < 156; index += 1) {
		header[index] = 32;
	}
	let checksum = 0;
	for (const byte of header) {
		checksum += byte;
	}
	const checksumField = `${checksum.toString(8).padStart(6, "0")}\0 `;
	writeString(header, 148, 8, checksumField);
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

function parseTarEntries(
	archive: Buffer<ArrayBufferLike>,
): WorkspaceFileEntry[] & { __raw?: TarEntry[] } {
	const tar = gunzipSync(archive);
	const entries: TarEntry[] = [];
	let offset = 0;
	while (offset + 512 <= tar.byteLength) {
		const header = tar.subarray(offset, offset + 512);
		if (isZeroBlock(header)) {
			break;
		}
		const path = readCString(header, 0, 100);
		const size = parseOctal(header, 124, 12);
		const typeByte = header[156] ?? 0;
		const typeFlag = typeByte === 0 ? "0" : String.fromCharCode(typeByte);
		offset += 512;
		const body = tar.subarray(offset, offset + size);
		const padded = Math.ceil(size / 512) * 512;
		offset += padded;
		if (path.length === 0 || (typeFlag !== "0" && typeFlag !== "")) {
			continue;
		}
		entries.push({
			path,
			body: Buffer.from(body),
		});
	}

	const listed = entries.map((entry) => ({
		path: entry.path,
		bytes: entry.body.byteLength,
		sha256: hashBytes(entry.body),
	}));
	(listed as WorkspaceFileEntry[] & { __raw?: TarEntry[] }).__raw = entries;
	return listed as WorkspaceFileEntry[] & { __raw?: TarEntry[] };
}

function buildTarArchive(
	entries: TarEntry[],
): Promise<Buffer<ArrayBufferLike>> {
	const parts: Buffer<ArrayBufferLike>[] = [];
	for (const entry of entries) {
		parts.push(buildTarHeader(entry));
		parts.push(entry.body);
		const remainder = entry.body.byteLength % 512;
		if (remainder !== 0) {
			parts.push(Buffer.alloc(512 - remainder, 0));
		}
	}
	parts.push(Buffer.alloc(1024, 0));
	return gzipBytes(Buffer.concat(parts));
}

export async function listWorkspaceFiles(input: {
	workspaceRef: ArtifactPointer;
	artifactService: ArtifactWriter;
}): Promise<{
	workspaceRef: ArtifactPointer;
	workspace_manifest: ReturnType<typeof buildWorkspaceManifest>;
}> {
	const archive = await readArtifactBuffer(
		input.artifactService,
		input.workspaceRef.sha256,
	);
	const entries = filterDurableWorkspaceEntries(parseTarEntries(archive));
	return {
		workspaceRef: input.workspaceRef,
		workspace_manifest: buildWorkspaceManifest(entries),
	};
}

export async function exportWorkspaceFiles(input: {
	runId: string;
	workspaceRef: ArtifactPointer;
	paths?: string[] | undefined;
	artifactService: ArtifactWriter;
}): Promise<{
	workspace_export: ArtifactPointer;
	workspace_manifest: ReturnType<typeof buildWorkspaceManifest>;
}> {
	const archive = await readArtifactBuffer(
		input.artifactService,
		input.workspaceRef.sha256,
	);
	const parsed = parseTarEntries(archive);
	const rawEntries = parsed.__raw ?? [];
	const allow = new Set((input.paths ?? []).filter((path) => path.length > 0));
	const selectedRaw = rawEntries.filter((entry) => {
		if (allow.size === 0) {
			return true;
		}
		return allow.has(entry.path);
	});
	const manifestEntries = filterDurableWorkspaceEntries(
		selectedRaw.map((entry) => ({
			path: entry.path,
			bytes: entry.body.byteLength,
			sha256: hashBytes(entry.body),
		})),
	);
	const exportBody = await buildTarArchive(
		selectedRaw.filter((entry) =>
			manifestEntries.some((manifest) => manifest.path === entry.path),
		),
	);
	const artifact = await input.artifactService.putArtifact({
		body: exportBody,
		mime: "application/gzip",
		type: "raw",
		meta: {
			"run.id": input.runId,
			"workspace.export": input.workspaceRef.sha256,
		},
	});
	return {
		workspace_export: { sha256: artifact.sha256 },
		workspace_manifest: buildWorkspaceManifest(manifestEntries),
	};
}
