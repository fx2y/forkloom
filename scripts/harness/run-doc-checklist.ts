import { pathToFileURL } from "node:url";
import { writeJson } from "./live-support";
import {
	collectDocChecklistReport,
	formatDocChecklistSummary,
	hasDocChecklistViolations,
} from "./spec07-sql";

async function main(): Promise<void> {
	const outputPath =
		process.argv[2] ?? ".cache/spec07/doc-checklist.report.json";
	const report = await collectDocChecklistReport();
	await writeJson(outputPath, report as Record<string, unknown>);

	const summary = formatDocChecklistSummary(report);
	console.log(`doc-checklist ${report.status}: ${summary}`);
	if (hasDocChecklistViolations(report)) {
		throw new Error(`doc checklist violations detected: ${summary}`);
	}
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
