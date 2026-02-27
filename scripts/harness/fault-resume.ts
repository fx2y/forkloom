import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

type State = {
	step1Done: boolean;
	step2Done: boolean;
};

const [statePath, sideEffectsPath, mode] = process.argv.slice(2);

if (!statePath || !sideEffectsPath || !mode) {
	console.error(
		"usage: tsx scripts/harness/fault-resume.ts <state.json> <side-effects.log> <first|resume>",
	);
	process.exit(1);
}

mkdirSync(dirname(statePath), { recursive: true });
mkdirSync(dirname(sideEffectsPath), { recursive: true });

const state: State = existsSync(statePath)
	? (JSON.parse(readFileSync(statePath, "utf8")) as State)
	: { step1Done: false, step2Done: false };

if (!state.step1Done) {
	appendFileSync(sideEffectsPath, "step1\n", "utf8");
	state.step1Done = true;
	writeFileSync(statePath, JSON.stringify(state), "utf8");
}

if (mode === "first") {
	console.error("simulated crash after step1");
	process.exit(17);
}

if (!state.step2Done) {
	appendFileSync(sideEffectsPath, "step2\n", "utf8");
	state.step2Done = true;
}

writeFileSync(statePath, JSON.stringify(state), "utf8");
