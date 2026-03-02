// Core API Type definitions for C5

export interface SpanRef {
  spanId: string;
  pageIdx: number;
  bbox: [number, number, number, number];
}

export interface ChunkHit {
  chunkId: string;
  score: number;
  text: string;
  spans: SpanRef[];
}

export interface SearchRequest {
  query: string;
  topK?: number;
}

export interface SearchResponse {
  hits: ChunkHit[];
}

export interface ResolveRequest {
  spanId: string;
}

export interface ResolveResponse {
  spanId: string;
  textSlice: string;
  bbox: [number, number, number, number];
  pageIdx: number;
}
