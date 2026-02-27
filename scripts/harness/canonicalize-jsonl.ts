import { readFileSync, writeFileSync } from "node:fs";
import { canonicalizeJsonl } from "../../src/harness/canonicalize";

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
	console.error(
		"usage: tsx scripts/harness/canonicalize-jsonl.ts <input.jsonl> <output.jsonl>",
	);
	process.exit(1);
}

const raw = readFileSync(inputPath, "utf8");
const canonical = canonicalizeJsonl(raw);
writeFileSync(outputPath, canonical, "utf8");
