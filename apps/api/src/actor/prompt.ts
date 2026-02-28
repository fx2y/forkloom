import type { PiPromptInput } from "../pi";
import {
	type PromptArtifactLoader,
	appendContextLine,
	loadPromptImages,
} from "../pi/prompt-input";
import type { ActorMailboxMessageModel, ActorStateModel } from "./ports";

export function buildActorPromptMessage(
	actor: ActorStateModel,
	message: ActorMailboxMessageModel,
): string {
	const contextLines: string[] = [];
	appendContextLine(
		contextLines,
		"attachmentRefs",
		message.attachments.map((attachment) => attachment.sha256).join(", "),
	);
	appendContextLine(contextLines, "workspaceId", actor.workspaceId ?? "");
	appendContextLine(contextLines, "memRef", actor.memRef ?? "");
	if (contextLines.length === 0) {
		return message.text;
	}
	return `${message.text}\n\nActor context:\n${contextLines.join("\n")}`;
}

export async function buildActorPromptInput(
	actor: ActorStateModel,
	message: ActorMailboxMessageModel,
	loader: PromptArtifactLoader,
): Promise<PiPromptInput> {
	const images = await loadPromptImages(message.attachments, loader);
	return {
		message: buildActorPromptMessage(actor, message),
		images: images.length > 0 ? images : undefined,
	};
}
