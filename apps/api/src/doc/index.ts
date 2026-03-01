export type * from "./ports";
export { DocService } from "./service";
export type { DocServiceDeps } from "./service";
export { PgDocRepo } from "./repo/postgres";
export {
	buildChunkJsonAlias,
	buildChunkMdAlias,
	buildParseJsonAlias,
	buildParseMdAlias,
	buildRawAlias,
} from "./alias";
export {
	DOC_PARSER,
	buildChunkId,
	buildDocSha,
	buildParseCfgHash,
	buildParseId,
	buildSpanId,
} from "./ids";
export { classifyDoc, countPdfPages } from "./classify";
export { DocAcquireService } from "./acquire";
export type { AcquireDocInput, AcquireDocResult } from "./acquire";
