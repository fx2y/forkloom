import { buildRawAlias } from "./alias";
import { buildDocSha, buildParseId } from "./ids";
import type { DocModel, ParseModel } from "./ports";

export type AcquireDocInput = {
	body: Uint8Array;
	mime: string;
	parser: string;
	parserVersion: string;
	cfgHash: string;
	normVersion: string;
};

export type AcquireDocResult = {
	docSha: string;
	parseId: string;
	rawAlias: string;
	shortCircuited: boolean;
	shortCircuitState: "none" | "inflight" | "done";
	doc: DocModel;
	parse: ParseModel;
};

export type AcquireDocRepo = {
	getDoc(docSha: string): Promise<DocModel | null>;
	getParse(parseId: string): Promise<ParseModel | null>;
	upsertDoc(input: {
		docSha: string;
		mime: string;
		bytes: number;
		rawArtifactSha: string | null;
		status: DocModel["status"];
		createdAt?: string | undefined;
		updatedAt?: string | undefined;
	}): Promise<DocModel>;
	upsertParse(input: {
		parseId: string;
		docSha: string;
		parser: string;
		parserVersion: string;
		cfgHash: string;
		normVersion: string;
		mdArtifactSha: string | null;
		jsonArtifactSha: string | null;
		stats: Record<string, unknown>;
		status: ParseModel["status"];
		createdAt?: string | undefined;
		updatedAt?: string | undefined;
	}): Promise<ParseModel>;
	aliasArtifact(input: { alias: string; sha256: string }): Promise<void>;
	resolveAlias(alias: string): Promise<string | null>;
};

export type DocAcquireServiceDeps = {
	repo: AcquireDocRepo;
	now?: () => Date;
};

export class DocAcquireService {
	private readonly now: () => Date;

	constructor(private readonly deps: DocAcquireServiceDeps) {
		this.now = deps.now ?? (() => new Date());
	}

	async acquire(input: AcquireDocInput): Promise<AcquireDocResult> {
		const docSha = buildDocSha(input.body);
		const parseId = buildParseId({
			docSha,
			parser: input.parser,
			parserVersion: input.parserVersion,
			cfgHash: input.cfgHash,
			normVersion: input.normVersion,
		});
		const rawAlias = buildRawAlias(docSha);
		const existingDoc = await this.deps.repo.getDoc(docSha);
		const existingParse = await this.deps.repo.getParse(parseId);
		const aliasedRawSha = await this.deps.repo.resolveAlias(rawAlias);
		if (aliasedRawSha != null && aliasedRawSha !== docSha) {
			throw new Error("raw alias points to a different doc sha");
		}

		if (
			existingDoc &&
			existingParse &&
			existingDoc.status !== "failed" &&
			existingParse.status !== "failed" &&
			aliasedRawSha === docSha
		) {
			const shortCircuitState: AcquireDocResult["shortCircuitState"] =
				existingDoc.status === "done" && existingParse.status === "done"
					? "done"
					: "inflight";
			return {
				docSha,
				parseId,
				rawAlias,
				shortCircuited: true,
				shortCircuitState,
				doc: existingDoc,
				parse: existingParse,
			};
		}

		const stamp = this.now().toISOString();
		const doc = await this.deps.repo.upsertDoc({
			docSha,
			mime: input.mime,
			bytes: input.body.byteLength,
			// Reserve doc row before blob write; raw SHA is attached in reserve step.
			rawArtifactSha: existingDoc?.rawArtifactSha ?? null,
			status: existingDoc?.status ?? "queued",
			createdAt: existingDoc ? undefined : stamp,
			updatedAt: stamp,
		});

		const parse = await this.deps.repo.upsertParse({
			parseId,
			docSha,
			parser: input.parser,
			parserVersion: input.parserVersion,
			cfgHash: input.cfgHash,
			normVersion: input.normVersion,
			mdArtifactSha: existingParse?.mdArtifactSha ?? null,
			jsonArtifactSha: existingParse?.jsonArtifactSha ?? null,
			stats: existingParse?.stats ?? {},
			status: existingParse?.status ?? "queued",
			createdAt: existingParse ? undefined : stamp,
			updatedAt: stamp,
		});

		return {
			docSha,
			parseId,
			rawAlias,
			shortCircuited: false,
			shortCircuitState: "none",
			doc,
			parse,
		};
	}
}
