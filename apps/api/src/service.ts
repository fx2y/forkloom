import { hashBytes, isSha256 } from "@forkloom/shared";
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

		await this.stepRunner.runStep("artifact-put-object", () =>
			this.deps.store.putObject({
				sha256,
				body: input.body,
				mime: input.mime,
			}),
		);

		const created = await this.stepRunner.runStep("artifact-insert-meta", () =>
			this.deps.repo.insert({
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

		return created;
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
