import { pathToFileURL } from "node:url";
import { writeJson } from "./live-support";
import {
	collectTruthChecklistReport,
	formatTruthChecklistSummary,
	hasTruthChecklistViolations,
} from "./spec06-sql";

async function main(): Promise<void> {
	const outputPath =
		process.argv[2] ?? ".cache/spec06/checklist-sql.report.json";
	const report = await collectTruthChecklistReport();
	await writeJson(outputPath, report as Record<string, unknown>);

	const summary = formatTruthChecklistSummary(report);
	console.log(`truth-checklist ${report.status}: ${summary}`);
	if (hasTruthChecklistViolations(report)) {
		throw new Error(`truth checklist violations detected: ${summary}`);
	}
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
