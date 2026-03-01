import {
	hashBytes,
	hashJSON,
	isSha256,
	stableStringify,
} from "@forkloom/shared";
import { InlineStepRunner, type StepRunner } from "./durability";
import { HttpError } from "./errors";
import type {
	ArtifactModel,
	ArtifactRepo,
	ArtifactStore,
	PutArtifactInput,
} from "./ports";

export type ArtifactServiceDeps = {
	repo: ArtifactRepo;
	store: ArtifactStore;
	now?: () => Date;
	s3Bucket: string;
	stepRunner?: StepRunner;
};

function ensureSha(value: string): string {
	if (!isSha256(value)) {
		throw new HttpError(400, "invalid sha256 path");
	}
	return value;
}

export class ArtifactService {
	private readonly now: () => Date;
	private readonly stepRunner: StepRunner;

	constructor(private readonly deps: ArtifactServiceDeps) {
		this.now = deps.now ?? (() => new Date());
		this.stepRunner = deps.stepRunner ?? new InlineStepRunner();
	}

	async putArtifact(input: PutArtifactInput): Promise<ArtifactModel> {
		const sha256 = hashBytes(input.body);
		if (input.expectedSha256 && input.expectedSha256 !== sha256) {
			throw new HttpError(400, "sha mismatch");
		}

		const existing = await this.deps.repo.getBySha256(sha256);
		if (existing) {
			if (input.force) {
				throw new HttpError(409, "immutable artifact");
			}
			return existing;
		}

		const reservation = await this.stepRunner.runStep(
			"artifact-insert-meta",
			() =>
				this.deps.repo.insertIfAbsent({
					sha256,
					uri: `s3://${this.deps.s3Bucket}/cas/${sha256.slice(0, 2)}/${sha256}`,
					mime: input.mime,
					bytes: input.body.byteLength,
					createdAt: this.now().toISOString(),
					type: input.type,
					parents: [],
					meta: input.meta,
				}),
		);

		if (!reservation.inserted) {
			if (input.force) {
				throw new HttpError(409, "immutable artifact");
			}
			return reservation.artifact;
		}

		try {
			await this.stepRunner.runStep("artifact-put-object", () =>
				this.deps.store.putObject({
					sha256,
					body: input.body,
					mime: input.mime,
				}),
			);
		} catch (error) {
			// Best-effort rollback: if object write fails we should not keep metadata-only rows.
			try {
				await this.deps.repo.deleteBySha256(sha256);
			} catch {
				// ignore cleanup failure to preserve original storage error
			}
			throw error;
		}

		return reservation.artifact;
	}

	async putJSON(input: {
		value: unknown;
		meta: Record<string, unknown>;
		parents?: string[] | undefined;
		type?: PutArtifactInput["type"] | undefined;
		mime?: string | undefined;
	}): Promise<ArtifactModel> {
		const bodyText = stableStringify(input.value);
		const artifact = await this.putArtifact({
			body: Buffer.from(bodyText, "utf8"),
			mime: input.mime ?? "application/json",
			type: input.type ?? "json",
			meta: input.meta,
			expectedSha256: hashJSON(input.value),
		});
		const parentSet = new Set(
			(input.parents ?? []).filter((parent) => parent !== artifact.sha256),
		);
		let linked = artifact;
		for (const parent of parentSet) {
			linked = await this.linkArtifact(linked.sha256, parent, {});
		}
		return linked;
	}

	async getArtifactMeta(sha256: string): Promise<ArtifactModel> {
		const safeSha = ensureSha(sha256);
		const found = await this.deps.repo.getBySha256(safeSha);
		if (!found) {
			throw new HttpError(404, "artifact not found");
		}
		return found;
	}

	async getArtifactBytes(
		sha256: string,
	): Promise<{ body: NodeJS.ReadableStream; contentType: string | null }> {
		const safeSha = ensureSha(sha256);
		const found = await this.deps.repo.getBySha256(safeSha);
		if (!found) {
			throw new HttpError(404, "artifact not found");
		}
		return this.deps.store.getObject(safeSha);
	}

	async linkArtifact(
		sha256: string,
		parent: string | null,
		metaPatch: Record<string, unknown>,
	): Promise<ArtifactModel> {
		const safeSha = ensureSha(sha256);
		if (parent && !isSha256(parent)) {
			throw new HttpError(400, "invalid parent sha256");
		}

		const next = await this.deps.repo.appendLink(safeSha, parent, metaPatch);
		if (!next) {
			throw new HttpError(404, "artifact not found");
		}
		return next;
	}
}
