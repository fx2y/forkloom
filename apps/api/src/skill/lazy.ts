import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	isSkillLazyResourcePath,
	resolveSkillPath,
	toSkillRelativePath,
} from "./paths";

export type SkillFileReadRequest = {
	type: "read-skill-file";
	relPath: string;
};

export type SkillFileReadResult = {
	path: string;
	body: Buffer;
};

export async function readSkillFileRequest(input: {
	skillPath: string;
	request: SkillFileReadRequest;
	readFileBytes?: ((path: string) => Promise<Buffer>) | undefined;
}): Promise<SkillFileReadResult> {
	if (input.request.type !== "read-skill-file") {
		throw new Error(`unsupported skill file request: ${input.request.type}`);
	}
	const skillDir = dirname(input.skillPath);
	const absolutePath = resolveSkillPath(skillDir, input.request.relPath);
	const relativePath = toSkillRelativePath(skillDir, absolutePath);
	if (!relativePath || !isSkillLazyResourcePath(relativePath)) {
		throw new Error(
			`skill file request must target references/* or assets/*: ${input.request.relPath}`,
		);
	}
	const bytes = await (input.readFileBytes ?? readFile)(absolutePath);
	return {
		path: relativePath,
		body: bytes,
	};
}
