import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ArtifactService } from "../service";

export type StagedSandboxInput = {
	sha256: string;
	fileName: string;
	hostPath: string;
	mountPath: string;
};

type ArtifactReader = Pick<ArtifactService, "getArtifactBytes">;

async function readStream(
	stream: NodeJS.ReadableStream,
): Promise<Buffer<ArrayBufferLike>> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of stream) {
		chunks.push(
			typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk),
		);
	}
	return Buffer.concat(chunks);
}

function toInputFileName(index: number, sha256: string): string {
	return `${String(index + 1).padStart(2, "0")}-${sha256}.bin`;
}

export async function readArtifactBuffer(
	artifactService: ArtifactReader,
	sha256: string,
): Promise<Buffer<ArrayBufferLike>> {
	const result = await artifactService.getArtifactBytes(sha256);
	return readStream(result.body);
}

export async function materializeSandboxInputs(input: {
	runId: string;
	attachments: Array<{ sha256: string }>;
	inputRoot: string;
	artifactService: ArtifactReader;
}): Promise<{
	stageDir: string;
	staged: StagedSandboxInput[];
}> {
	const stageDir = resolve(input.inputRoot, input.runId);
	await rm(stageDir, { recursive: true, force: true });
	await mkdir(stageDir, { recursive: true });

	const staged: StagedSandboxInput[] = [];
	for (const [index, attachment] of input.attachments.entries()) {
		const fileName = toInputFileName(index, attachment.sha256);
		const hostPath = join(stageDir, fileName);
		await writeFile(
			hostPath,
			await readArtifactBuffer(input.artifactService, attachment.sha256),
		);
		staged.push({
			sha256: attachment.sha256,
			fileName,
			hostPath,
			mountPath: `/inputs/${fileName}`,
		});
	}

	return { stageDir, staged };
}
