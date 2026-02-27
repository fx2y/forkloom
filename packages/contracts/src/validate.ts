import addFormats from "ajv-formats";
import Ajv2020, {
	type ErrorObject,
	type ValidateFunction,
} from "ajv/dist/2020.js";
import artifactSchema from "../../../contracts/v0/Artifact.schema.json" with {
	type: "json",
};
import artifactRefSchema from "../../../contracts/v0/ArtifactRef.schema.json" with {
	type: "json",
};
import extensionSchema from "../../../contracts/v0/Extension.schema.json" with {
	type: "json",
};
import messageSchema from "../../../contracts/v0/Message.schema.json" with {
	type: "json",
};
import skillSchema from "../../../contracts/v0/Skill.schema.json" with {
	type: "json",
};
import workflowSchema from "../../../contracts/v0/Workflow.schema.json" with {
	type: "json",
};
import runEventSchema from "../../../contracts/v1/RunEvent.schema.json" with {
	type: "json",
};
import runSpecSchema from "../../../contracts/v1/RunSpec.schema.json" with {
	type: "json",
};
import runStateSchema from "../../../contracts/v1/RunState.schema.json" with {
	type: "json",
};

export type ContractName =
	| "Message"
	| "Artifact"
	| "Workflow"
	| "Skill"
	| "Extension";
export type RunContractName = "RunSpec" | "RunState" | "RunEvent";
export type AnyContractName = ContractName | RunContractName;

const ajv = addFormats(new Ajv2020({ allErrors: true, strict: true }));
ajv.addSchema(artifactRefSchema);

const v0Validators: Record<ContractName, ValidateFunction> = {
	Message: ajv.compile(messageSchema),
	Artifact: ajv.compile(artifactSchema),
	Workflow: ajv.compile(workflowSchema),
	Skill: ajv.compile(skillSchema),
	Extension: ajv.compile(extensionSchema),
};
const v1RunValidators: Record<RunContractName, ValidateFunction> = {
	RunSpec: ajv.compile(runSpecSchema),
	RunState: ajv.compile(runStateSchema),
	RunEvent: ajv.compile(runEventSchema),
};
const artifactProperties =
	(artifactSchema as { properties?: Record<string, unknown> }).properties ?? {};
const artifactMetaSchema = artifactProperties.meta;
if (!artifactMetaSchema || typeof artifactMetaSchema !== "object") {
	throw new Error("Artifact.meta schema is required for meta validation");
}
const validateArtifactMetaFn = ajv.compile(artifactMetaSchema);

function toErrors(errors: ErrorObject[] | null | undefined): string[] {
	return (errors ?? []).map(
		(error) => `${error.instancePath || "/"} ${error.message || "invalid"}`,
	);
}

function validateWith<TName extends string>(
	validators: Record<TName, ValidateFunction>,
	name: TName,
	input: unknown,
): { valid: boolean; errors: string[] } {
	const validate = validators[name];
	const valid = validate(input);
	return {
		valid: Boolean(valid),
		errors: toErrors(validate.errors),
	};
}

export function validateByName(
	name: ContractName,
	input: unknown,
): {
	valid: boolean;
	errors: string[];
} {
	return validateWith(v0Validators, name, input);
}

export function getContractNames(): ContractName[] {
	return Object.keys(v0Validators) as ContractName[];
}

export function validateRunByName(
	name: RunContractName,
	input: unknown,
): {
	valid: boolean;
	errors: string[];
} {
	return validateWith(v1RunValidators, name, input);
}

export function getRunContractNames(): RunContractName[] {
	return Object.keys(v1RunValidators) as RunContractName[];
}

export function validateAnyByName(
	name: AnyContractName,
	input: unknown,
): {
	valid: boolean;
	errors: string[];
} {
	if (name in v0Validators) {
		return validateWith(v0Validators, name as keyof typeof v0Validators, input);
	}
	return validateWith(
		v1RunValidators,
		name as keyof typeof v1RunValidators,
		input,
	);
}

export function getAllContractNames(): AnyContractName[] {
	return [...getContractNames(), ...getRunContractNames()];
}

export function validateArtifactMeta(input: unknown): {
	valid: boolean;
	errors: string[];
} {
	const valid = validateArtifactMetaFn(input);
	return {
		valid: Boolean(valid),
		errors: toErrors(validateArtifactMetaFn.errors),
	};
}
