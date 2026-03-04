import { DBOS } from "@dbos-inc/dbos-sdk";
import {
	createPromotionScopedRepo,
	type PromotionSourceRow,
} from "./promotion-scoped-repo";

type PromoteWsToOrgStep = "loadSource" | "copyRef" | "copyProvenance";

type PromoteWsToOrgStepRunner = {
	runStep<T>(name: PromoteWsToOrgStep, fn: () => Promise<T>): Promise<T>;
};

const dbosStepRunner: PromoteWsToOrgStepRunner = {
	runStep<T>(name: PromoteWsToOrgStep, fn: () => Promise<T>): Promise<T> {
		return DBOS.runStep(fn, { name });
	},
};

export type PromoteWsToOrgInput = {
	orgId: string;
	wsId: string;
	kind: string;
	key: string;
};

export type PromoteWsToOrgOutput = {
	sha: string | null;
};

export type PromoteWsToOrgDeps = {
	databaseUrl: string;
	repo?: PromoteWsToOrgRepo | undefined;
};

type PromoteWsToOrgRepo = {
	loadSource(input: PromoteWsToOrgInput): Promise<PromotionSourceRow>;
	copyRef(
		input: PromoteWsToOrgInput,
		source: PromotionSourceRow,
	): Promise<string | null>;
	copyProvenance(_input: PromoteWsToOrgInput, _sha: string | null): Promise<void>;
};

function createPgRepo(databaseUrl: string): PromoteWsToOrgRepo {
	const repo = createPromotionScopedRepo(databaseUrl);
	return {
		async loadSource(input: PromoteWsToOrgInput): Promise<PromotionSourceRow> {
			const row = await repo.loadWsSource(input);
			if (!row) {
				throw new Error("workspace-scope source row not found");
			}
			return row;
		},
		async copyRef(
			input: PromoteWsToOrgInput,
			source: PromotionSourceRow,
		): Promise<string | null> {
			return repo.copyWsToOrg(input, source);
		},
		async copyProvenance(): Promise<void> {
			// Promotion preserves immutable provenance by re-pointing to the same CAS sha.
		},
	};
}

export async function executePromoteWsToOrg(
	input: PromoteWsToOrgInput,
	deps: PromoteWsToOrgDeps,
	steps: PromoteWsToOrgStepRunner = dbosStepRunner,
): Promise<PromoteWsToOrgOutput> {
	const repo = deps.repo ?? createPgRepo(deps.databaseUrl);
	const source = await steps.runStep("loadSource", () => repo.loadSource(input));
	const copied = await steps.runStep("copyRef", () => repo.copyRef(input, source));
	await steps.runStep("copyProvenance", async () => {
		await repo.copyProvenance(input, copied);
		return copied;
	});
	return { sha: copied };
}

let activeDeps: PromoteWsToOrgDeps | null = null;
let registeredWorkflow:
	| ((input: PromoteWsToOrgInput) => Promise<PromoteWsToOrgOutput>)
	| null = null;

export function registerPromoteWsToOrgWorkflow(
	deps: PromoteWsToOrgDeps,
): (input: PromoteWsToOrgInput) => Promise<PromoteWsToOrgOutput> {
	activeDeps = deps;
	if (!registeredWorkflow) {
		registeredWorkflow = DBOS.registerWorkflow(
			async (input: PromoteWsToOrgInput): Promise<PromoteWsToOrgOutput> => {
				const currentDeps = activeDeps;
				if (!currentDeps) {
					throw new Error("PromoteWsToOrg deps are not registered");
				}
				return executePromoteWsToOrg(input, currentDeps, dbosStepRunner);
			},
			{
				name: "PromoteWsToOrgV1",
			},
		);
	}
	return registeredWorkflow;
}
