import { Buffer } from "node:buffer";
import type { PiImageInput, PiPromptInput } from "../pi";
import type { ArtifactModel } from "../ports";
import type { RunSpecModel } from "../run/ports";

type PromptArtifactLoader = {
	getArtifactMeta(sha256: string): Promise<ArtifactModel>;
	getArtifactBytes(sha256: string): Promise<{
		body: NodeJS.ReadableStream;
		contentType: string | null;
	}>;
};

function appendContextLine(
	lines: string[],
	label: string,
	value: string,
): void {
	if (value.length === 0) {
		return;
	}
	lines.push(`- ${label}: ${value}`);
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

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

export async function loadPromptImages(
	spec: RunSpecModel,
	loader: PromptArtifactLoader,
): Promise<PiImageInput[]> {
	const images: PiImageInput[] = [];
	for (const attachment of spec.attachments) {
		const meta = await loader.getArtifactMeta(attachment.sha256);
		if (!meta.mime.startsWith("image/")) {
			continue;
		}
		const object = await loader.getArtifactBytes(attachment.sha256);
		const bytes = await readAll(object.body);
		images.push({
			type: "image",
			data: bytes.toString("base64"),
			mimeType: object.contentType ?? meta.mime,
		});
	}
	return images;
}

export async function buildRunPromptInput(
	spec: RunSpecModel,
	loader: PromptArtifactLoader,
): Promise<PiPromptInput> {
	const images = await loadPromptImages(spec, loader);
	return {
		message: buildRunPromptMessage(spec),
		images: images.length > 0 ? images : undefined,
	};
}
