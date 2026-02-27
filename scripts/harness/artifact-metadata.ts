import { writeFileSync } from "node:fs";
import { hashFile } from "../../src/harness/artifact";

const [filePath, outputPath] = process.argv.slice(2);

if (!filePath || !outputPath) {
	console.error(
		"usage: tsx scripts/harness/artifact-metadata.ts <file> <out.json>",
	);
	process.exit(1);
}

const meta = hashFile(filePath);
writeFileSync(
	outputPath,
	`${JSON.stringify(
		{
			path: filePath,
			...meta,
		},
		null,
		2,
	)}\n`,
	"utf8",
);
