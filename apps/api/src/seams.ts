export type ApiSeamName = "actor" | "run" | "pi" | "workflow" | "http";

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
	run: {
		owner: "run domain",
		root: "apps/api/src/run",
		intent: "run contracts and run event vocabulary",
		canImportFrom: ["apps/api/src/pi", "apps/api/src/workflow"],
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
		canImportFrom: ["apps/api/src/service", "apps/api/src/ports"],
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
	actorLiveHarness: {
		root: "scripts/harness/run-live-support.ts",
		status: "defer-until-second-caller",
		intent: "clone the run live harness only when actor live proofs exist",
	},
};
