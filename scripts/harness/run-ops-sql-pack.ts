import { pathToFileURL } from "node:url";
import { writeJson } from "./live-support";
import { collectOpsSqlPack } from "./spec06-sql";

async function main(): Promise<void> {
	const [runIdArg, outputArg] = process.argv.slice(2);
	const report = await collectOpsSqlPack(runIdArg ? { runId: runIdArg } : {});
	const outputPath = outputArg ?? ".cache/spec06/ops-sql-pack.json";
	await writeJson(outputPath, report as Record<string, unknown>);
	console.log(
		`ops-sql-pack ok: targetRunId=${report.targetRunId ?? "none"} recentRuns=${report.recentRuns.length} driftRows=${report.driftRows.length}`,
	);
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
