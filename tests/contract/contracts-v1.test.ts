import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	getActorContractNames,
	getRunContractNames,
	validateActorByName,
	validateRunByName,
} from "../../packages/contracts/src/run-validate";

function contractForExample(
	name: string,
):
	| "RunSpec"
	| "RunState"
	| "RunEvent"
	| "TruthBundle"
	| "ActorSpec"
	| "MailboxPost"
	| "ActorState"
	| "ActorEvent" {
	const prefix = name.split(".")[0];
	switch (prefix) {
		case "actor-spec":
			return "ActorSpec";
		case "mailbox-post":
			return "MailboxPost";
		case "actor-state":
			return "ActorState";
		case "actor-event":
			return "ActorEvent";
		case "run-spec":
			return "RunSpec";
		case "run-state":
			return "RunState";
		case "run-event":
			return "RunEvent";
		case "truth-bundle":
			return "TruthBundle";
		default:
			throw new Error(`unknown example prefix: ${name}`);
	}
}

describe("contracts/v1 examples", () => {
	const dir = resolve("contracts/v1/examples");
	const files = readdirSync(dir).filter((file) => file.endsWith(".json"));

	for (const file of files) {
		it(`validates ${file}`, () => {
			const payload = JSON.parse(
				readFileSync(resolve(dir, file), "utf8"),
			) as unknown;
			if (file.endsWith(".invalid.json")) {
				const anyValid = [
					...getRunContractNames(),
					...getActorContractNames(),
				].some((name) =>
					name === "RunSpec" ||
					name === "RunState" ||
					name === "RunEvent" ||
					name === "TruthBundle"
						? validateRunByName(name, payload).valid
						: validateActorByName(name, payload).valid,
				);
				expect(anyValid).toBe(false);
				return;
			}

			const contract = contractForExample(file);
			const result =
				contract === "RunSpec" ||
				contract === "RunState" ||
				contract === "RunEvent" ||
				contract === "TruthBundle"
					? validateRunByName(contract, payload)
					: validateActorByName(contract, payload);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});
	}
});
