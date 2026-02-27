export type ApiSeamName = "run" | "pi" | "workflow" | "http";

type ApiSeam = {
	owner: string;
	root: string;
	intent: string;
	canImportFrom: readonly string[];
};

export const API_SEAMS: Record<ApiSeamName, ApiSeam> = {
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
