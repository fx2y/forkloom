import type { PiPromptInput } from "../pi";
import {
	appendContextLine,
	loadPromptImages as loadPromptImagesFromAttachments,
	type PromptArtifactLoader,
} from "../pi/prompt-input";
import type { RunSpecModel } from "../run/ports";

export function buildRunPromptMessage(spec: RunSpecModel): string {
	const contextLines: string[] = [];
	appendContextLine(
		contextLines,
		"attachmentRefs",
		spec.attachments.map((attachment) => attachment.sha256).join(", "),
	);
	appendContextLine(contextLines, "workdirRef", spec.workdirRef?.sha256 ?? "");
	appendContextLine(contextLines, "modelPref", spec.modelPref ?? "");
	if (contextLines.length === 0) {
		return spec.userMsg;
	}
	return `${spec.userMsg}\n\nRun context:\n${contextLines.join("\n")}`;
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
): Promise<PiPromptInput> {
	const images = await loadPromptImagesFromAttachments(spec.attachments, loader);
	return {
		message: buildRunPromptMessage(spec),
		images: images.length > 0 ? images : undefined,
	};
}
