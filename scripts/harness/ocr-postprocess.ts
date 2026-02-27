import { readFileSync, writeFileSync } from "node:fs";
import { type OcrRawResult, normalizeOcrResult } from "../../src/harness/ocr";

const [inputPath, outPrefix] = process.argv.slice(2);

if (!inputPath || !outPrefix) {
	console.error(
		"usage: tsx scripts/harness/ocr-postprocess.ts <raw.json> <out-prefix>",
	);
	process.exit(1);
}

const raw = JSON.parse(readFileSync(inputPath, "utf8")) as OcrRawResult;
const out = normalizeOcrResult(raw);

writeFileSync(`${outPrefix}.md`, `${out.markdown}\n`, "utf8");
writeFileSync(
	`${outPrefix}.json`,
	`${JSON.stringify({ json: out.json, spans: out.spans }, null, 2)}\n`,
	"utf8",
);
writeFileSync(
	`${outPrefix}.manifest.json`,
	`${JSON.stringify({ sha256: out.sha256 }, null, 2)}\n`,
	"utf8",
);
