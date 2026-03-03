export type ApiSeamName =
	| "actor"
	| "doc"
	| "skill"
	| "run"
	| "sandbox"
	| "pi"
	| "workflow"
	| "http";

type ApiSeam = {
	owner: string;
	root: string;
	intent: string;
	canImportFrom: readonly string[];
};

export const API_SEAMS: Record<ApiSeamName, ApiSeam> = {
	actor: {
		owner: "actor domain",
		root: "apps/api/src/actor",
		intent:
			"actor/mailbox nouns and service boundary before SQL/runtime wiring",
		canImportFrom: [],
	},
	doc: {
		owner: "doc ingest domain",
		root: "apps/api/src/doc",
		intent: "typed ingest rows, alias law, and doc transaction seam",
		canImportFrom: ["apps/api/src/service"],
	},
	skill: {
		owner: "skill registry domain",
		root: "apps/api/src/skill",
		intent:
			"skill manifest normalization, discovery, and preview before run/http wiring",
		canImportFrom: [],
	},
	run: {
		owner: "run domain",
		root: "apps/api/src/run",
		intent: "run contracts and run event vocabulary",
		canImportFrom: ["apps/api/src/pi", "apps/api/src/workflow"],
	},
	sandbox: {
		owner: "sandbox runtime",
		root: "apps/api/src/sandbox",
		intent: "container/workspace/exec policy and backend boundary",
		canImportFrom: ["apps/api/src/pi"],
	},
	pi: {
		owner: "pi adapter",
		root: "apps/api/src/pi",
		intent: "rpc command/event boundary for PI subprocess",
		canImportFrom: ["apps/api/src/workflow"],
	},
	workflow: {
		owner: "durable workflow",
		root: "apps/api/src/workflow",
		intent: "named DBOS run steps and orchestration state",
		canImportFrom: [
			"apps/api/src/service",
			"apps/api/src/ports",
			"apps/api/src/doc",
		],
	},
	http: {
		owner: "http transport",
		root: "apps/api/src/http",
		intent: "parse + validate + delegate only",
		canImportFrom: ["apps/api/src/service"],
	},
};

export type ApiReuseCutName =
	| "sseBuffer"
	| "eventReplayCursor"
	| "piRpcClient"
	| "actorLiveHarness";

type ApiReuseCut = {
	root: string;
	status: "shared-now" | "defer-until-second-caller";
	intent: string;
};

export const API_REUSE_CUTS: Record<ApiReuseCutName, ApiReuseCut> = {
	sseBuffer: {
		root: "apps/api/src/http/sse-buffer.ts",
		status: "shared-now",
		intent:
			"share backpressure/gap buffering while keeping run vs actor stream policy separate",
	},
	eventReplayCursor: {
		root: "apps/api/src/http/event-stream.ts",
		status: "shared-now",
		intent: "share cursor parse + limit clamp without coupling parser modules",
	},
	piRpcClient: {
		root: "apps/api/src/pi/rpc-client.ts",
		status: "shared-now",
		intent:
			"reuse the JSONL rpc pump from sandbox callers instead of forking protocol code",
	},
	actorLiveHarness: {
		root: "scripts/harness/run-live-support.ts",
		status: "defer-until-second-caller",
		intent: "clone the run live harness only when actor live proofs exist",
	},
};

export const API_OWNERSHIP_LAW = {
	run: "run owns preview/state/commands/files on the public wire",
	doc: "doc ingest/search stays internal until attached under run-owned /runs",
	skill:
		"skill owns registry/frontmatter/preview logic; list/preview stay nested under run-owned /runs",
	sandbox: "sandbox owns container/workspace/exec/image lifecycle off-wire",
	actorReuseOnly:
		"actor contributes lease/queue law reuse-only; actor nouns stay off the run wire",
} as const;
