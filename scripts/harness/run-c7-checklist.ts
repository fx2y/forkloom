import { pathToFileURL } from "node:url";
import { writeJson } from "./live-support";
import {
	collectSpec09ChecklistReport,
	formatSpec09ChecklistSummary,
	hasSpec09ChecklistViolations,
} from "./spec09-sql";

async function main(): Promise<void> {
	const outputPath =
		process.argv[2] ?? ".cache/spec09/c7-checklist.report.json";
	const report = await collectSpec09ChecklistReport();
	await writeJson(outputPath, report as unknown as Record<string, unknown>);
	const summary = formatSpec09ChecklistSummary(report);
	console.log(`c7-checklist ${report.status}: ${summary}`);
	if (hasSpec09ChecklistViolations(report)) {
		throw new Error(`spec09 checklist violations detected: ${summary}`);
	}
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
