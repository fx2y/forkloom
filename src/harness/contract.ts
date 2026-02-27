import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import schema from "../../schema/pi-session-event.schema.json" with {
	type: "json",
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateEvent = ajv.compile(schema);

export type ContractValidationResult = {
	valid: boolean;
	errors: string[];
};

export function validatePiSessionEvent(
	input: unknown,
): ContractValidationResult {
	const valid = validateEvent(input);
	if (valid) {
		return { valid: true, errors: [] };
	}

	const errors = (validateEvent.errors ?? []).map(
		(error: ErrorObject) =>
			`${error.instancePath || "/"} ${error.message || "invalid"}`,
	);

	return {
		valid: false,
		errors,
	};
}
