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

export type ContractName =
	| "Message"
	| "Artifact"
	| "Workflow"
	| "Skill"
	| "Extension";

const ajv = addFormats(new Ajv2020({ allErrors: true, strict: true }));
ajv.addSchema(artifactRefSchema);

const validators: Record<ContractName, ValidateFunction> = {
	Message: ajv.compile(messageSchema),
	Artifact: ajv.compile(artifactSchema),
	Workflow: ajv.compile(workflowSchema),
	Skill: ajv.compile(skillSchema),
	Extension: ajv.compile(extensionSchema),
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

export function validateByName(
	name: ContractName,
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

export function getContractNames(): ContractName[] {
	return Object.keys(validators) as ContractName[];
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
