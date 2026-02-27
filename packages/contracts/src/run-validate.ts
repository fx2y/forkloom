import addFormats from "ajv-formats";
import Ajv2020, {
	type ErrorObject,
	type ValidateFunction,
} from "ajv/dist/2020.js";
import runEventSchema from "../../../contracts/v1/RunEvent.schema.json" with {
	type: "json",
};
import runSpecSchema from "../../../contracts/v1/RunSpec.schema.json" with {
	type: "json",
};
import runStateSchema from "../../../contracts/v1/RunState.schema.json" with {
	type: "json",
};

export type RunContractName = "RunSpec" | "RunState" | "RunEvent";

const ajv = addFormats(new Ajv2020({ allErrors: true, strict: true }));

const validators: Record<RunContractName, ValidateFunction> = {
	RunSpec: ajv.compile(runSpecSchema),
	RunState: ajv.compile(runStateSchema),
	RunEvent: ajv.compile(runEventSchema),
};

function toErrors(errors: ErrorObject[] | null | undefined): string[] {
	return (errors ?? []).map(
		(error) => `${error.instancePath || "/"} ${error.message || "invalid"}`,
	);
}

export function validateRunByName(
	name: RunContractName,
	input: unknown,
): {
	valid: boolean;
	errors: string[];
} {
	const validate = validators[name];
	const valid = validate(input);
	return {
		valid: Boolean(valid),
		errors: toErrors(validate.errors),
	};
}

export function getRunContractNames(): RunContractName[] {
	return Object.keys(validators) as RunContractName[];
}
