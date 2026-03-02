import { access, readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { writeJson } from "./live-support";

type NastyManifest = {
	manifest: string;
	version: string;
	docs: Array<{
		id: string;
		path: string;
		classes: string[];
	}>;
};

const REQUIRED_CLASSES = ["rotated", "table", "formula", "stamp", "lang"];
const MIN_DOC_BYTES = 3_000;
const ALLOWED_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg"]);

async function assertPathExists(path: string): Promise<void> {
	try {
		await access(path);
	} catch {
		throw new Error(`missing corpus file: ${path}`);
	}
}

function parseManifest(raw: string): NastyManifest {
	const parsed = JSON.parse(raw) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("invalid nasty manifest: root object required");
	}
	const manifest = parsed as Record<string, unknown>;
	if (!Array.isArray(manifest.docs) || manifest.docs.length < 10) {
		throw new Error("invalid nasty manifest: docs must contain >=10 entries");
	}
	return manifest as NastyManifest;
}

export async function verifyNastyCorpus(input: {
	manifestPath: string;
	outputPath: string;
}): Promise<void> {
	const raw = await readFile(input.manifestPath, "utf8");
	const manifest = parseManifest(raw);
	const classes = new Set<string>();
	const extCounts = new Map<string, number>();
	const classCounts = new Map<string, number>();
	for (const doc of manifest.docs) {
		if (typeof doc.id !== "string" || doc.id.trim().length === 0) {
			throw new Error("invalid nasty manifest: doc id is required");
		}
		if (typeof doc.path !== "string" || doc.path.trim().length === 0) {
			throw new Error(`invalid nasty manifest: path missing for ${doc.id}`);
		}
		await assertPathExists(doc.path);
		const lowerPath = doc.path.toLowerCase();
		const ext = lowerPath.slice(lowerPath.lastIndexOf("."));
		if (!ALLOWED_EXT.has(ext)) {
			throw new Error(
				`invalid corpus extension for ${doc.id}: ${ext} (expected pdf/png/jpg/jpeg)`,
			);
		}
		const size = await stat(doc.path);
		if (size.size < MIN_DOC_BYTES) {
			throw new Error(
				`corpus doc too small for ${doc.id}: ${size.size} bytes < ${MIN_DOC_BYTES}`,
			);
		}
		extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
		for (const klass of doc.classes) {
			classes.add(klass);
			classCounts.set(klass, (classCounts.get(klass) ?? 0) + 1);
		}
	}
	for (const required of REQUIRED_CLASSES) {
		if (!classes.has(required)) {
			throw new Error(`nasty corpus missing class coverage: ${required}`);
		}
	}
	for (const required of REQUIRED_CLASSES) {
		if ((classCounts.get(required) ?? 0) < 2) {
			throw new Error(
				`nasty corpus class under-covered: ${required} (<2 documents)`,
			);
		}
	}
	await writeJson(input.outputPath, {
		status: "ok",
		manifest: manifest.manifest,
		version: manifest.version,
		docCount: manifest.docs.length,
		classes: [...classes].sort(),
		classCounts: Object.fromEntries([...classCounts.entries()].sort()),
		extCounts: Object.fromEntries([...extCounts.entries()].sort()),
		minDocBytes: MIN_DOC_BYTES,
	});
}

async function main(): Promise<void> {
	const manifestPath = process.argv[2] ?? "fixtures/ocr/nasty/MANIFEST.json";
	const outputPath = process.argv[3] ?? ".cache/spec07/cy10-corpus.verify.json";
	await verifyNastyCorpus({ manifestPath, outputPath });
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
