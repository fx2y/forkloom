import type { Readable } from "node:stream";

export type ArtifactType = "raw" | "md" | "json" | "trace" | "other";

export type ArtifactMeta = Record<string, unknown>;

export type ArtifactModel = {
	sha256: string;
	uri: string;
	mime: string;
	bytes: number;
	createdAt: string;
	type: ArtifactType;
	parents: string[];
	meta: ArtifactMeta;
};

export type PutArtifactInput = {
	body: Buffer;
	mime: string;
	type: ArtifactType;
	meta: ArtifactMeta;
	expectedSha256?: string | undefined;
	force?: boolean | undefined;
};

export type PutObjectInput = {
	sha256: string;
	body: Buffer;
	mime: string;
};

export interface ArtifactStore {
	ensureBucket(): Promise<void>;
	putObject(input: PutObjectInput): Promise<void>;
	getObject(
		sha256: string,
	): Promise<{ body: Readable; contentType: string | null }>;
	ping(): Promise<boolean>;
}

export interface ArtifactRepo {
	ping(): Promise<boolean>;
	getBySha256(sha256: string): Promise<ArtifactModel | null>;
	insert(model: ArtifactModel): Promise<ArtifactModel>;
	appendLink(
		sha256: string,
		parent: string | null,
		metaPatch: ArtifactMeta,
	): Promise<ArtifactModel | null>;
}
