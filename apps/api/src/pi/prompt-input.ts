import { Buffer } from "node:buffer";
import type { ArtifactModel } from "../ports";
import type { PiImageInput } from "./session-port";

export type PromptAttachmentPointer = {
	sha256: string;
};

export type PromptArtifactLoader = {
	getArtifactMeta(sha256: string): Promise<ArtifactModel>;
	getArtifactBytes(sha256: string): Promise<{
		body: NodeJS.ReadableStream;
		contentType: string | null;
	}>;
};

export function appendContextLine(
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

export async function loadPromptImages(
	attachments: readonly PromptAttachmentPointer[],
	loader: PromptArtifactLoader,
): Promise<PiImageInput[]> {
	const images: PiImageInput[] = [];
	for (const attachment of attachments) {
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
