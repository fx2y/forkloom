import { pathToFileURL } from "node:url";
import { writeJson } from "./live-support";
import {
	collectSpec08ChecklistReport,
	formatSpec08ChecklistSummary,
	hasSpec08ChecklistViolations,
} from "./spec08-sql";

async function main(): Promise<void> {
	const outputPath =
		process.argv[2] ?? ".cache/spec08/skills-checklist.report.json";
	const report = await collectSpec08ChecklistReport();
	await writeJson(outputPath, report as unknown as Record<string, unknown>);
	const summary = formatSpec08ChecklistSummary(report);
	console.log(`skills-checklist ${report.status}: ${summary}`);
	if (hasSpec08ChecklistViolations(report)) {
		throw new Error(`spec08 checklist violations detected: ${summary}`);
	}
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
