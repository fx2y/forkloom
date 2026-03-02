import type { PiPromptInput } from "../pi";
import {
	type PromptArtifactLoader,
	appendContextLine,
	loadPromptImages as loadPromptImagesFromAttachments,
} from "../pi/prompt-input";
import type { RunSpecModel } from "../run/ports";

export type BuildRunPromptOptions = {
	availableSkillsXml?: string | undefined;
};

export function buildRunPromptMessage(
	spec: RunSpecModel,
	options: BuildRunPromptOptions = {},
): string {
	const contextLines: string[] = [];
	appendContextLine(
		contextLines,
		"attachmentRefs",
		spec.attachments.map((attachment) => attachment.sha256).join(", "),
	);
	appendContextLine(contextLines, "workdirRef", spec.workdirRef?.sha256 ?? "");
	appendContextLine(contextLines, "modelPref", spec.modelPref ?? "");
	const sections: string[] = [spec.userMsg];
	if (options.availableSkillsXml) {
		sections.push(options.availableSkillsXml);
	}
	if (contextLines.length > 0) {
		sections.push(`Run context:\n${contextLines.join("\n")}`);
	}
	return sections.join("\n\n");
}

export function loadPromptImages(
	spec: RunSpecModel,
	loader: PromptArtifactLoader,
) {
	return loadPromptImagesFromAttachments(spec.attachments, loader);
}

export async function buildRunPromptInput(
	spec: RunSpecModel,
	loader: PromptArtifactLoader,
	options: BuildRunPromptOptions = {},
): Promise<PiPromptInput> {
	const images = await loadPromptImagesFromAttachments(
		spec.attachments,
		loader,
	);
	return {
		message: buildRunPromptMessage(spec, options),
		images: images.length > 0 ? images : undefined,
	};
}
