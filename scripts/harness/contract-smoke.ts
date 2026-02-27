import { readFileSync } from "node:fs";
import { validatePiSessionEvent } from "../../src/harness/contract";

const [fixturePath] = process.argv.slice(2);

if (!fixturePath) {
	console.error("usage: tsx scripts/harness/contract-smoke.ts <fixture.json>");
	process.exit(1);
}

const payload = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
const result = validatePiSessionEvent(payload);
if (!result.valid) {
	console.error(result.errors.join("\n"));
	process.exit(1);
}
