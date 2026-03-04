import { DBOS } from "@dbos-inc/dbos-sdk";
import {
	createPromotionScopedRepo,
	type PromotionSourceRow,
} from "./promotion-scoped-repo";

type PromoteMemberToWsStep = "loadSource" | "copyRef" | "copyProvenance";

type PromoteMemberToWsStepRunner = {
	runStep<T>(name: PromoteMemberToWsStep, fn: () => Promise<T>): Promise<T>;
};

const dbosStepRunner: PromoteMemberToWsStepRunner = {
	runStep<T>(name: PromoteMemberToWsStep, fn: () => Promise<T>): Promise<T> {
		return DBOS.runStep(fn, { name });
	},
};

export type PromoteMemberToWsInput = {
	orgId: string;
	wsId: string;
	memberId: string;
	kind: string;
	key: string;
};

export type PromoteMemberToWsOutput = {
	sha: string | null;
};

export type PromoteMemberToWsDeps = {
	databaseUrl: string;
	repo?: PromoteMemberToWsRepo | undefined;
};

type PromoteMemberToWsRepo = {
	loadSource(input: PromoteMemberToWsInput): Promise<PromotionSourceRow>;
	copyRef(
		input: PromoteMemberToWsInput,
		source: PromotionSourceRow,
	): Promise<string | null>;
	copyProvenance(
		_input: PromoteMemberToWsInput,
		_sha: string | null,
	): Promise<void>;
};

function createPgRepo(databaseUrl: string): PromoteMemberToWsRepo {
	const repo = createPromotionScopedRepo(databaseUrl);
	return {
		async loadSource(
			input: PromoteMemberToWsInput,
		): Promise<PromotionSourceRow> {
			const row = await repo.loadMemberSource(input);
			if (!row) {
				throw new Error("member-scope source row not found");
			}
			return row;
		},
		async copyRef(
			input: PromoteMemberToWsInput,
			source: PromotionSourceRow,
		): Promise<string | null> {
			return repo.copyMemberToWs(input, source);
		},
		async copyProvenance(): Promise<void> {
			// Promotion preserves immutable provenance by re-pointing to the same CAS sha.
		},
	};
}

export async function executePromoteMemberToWs(
	input: PromoteMemberToWsInput,
	deps: PromoteMemberToWsDeps,
	steps: PromoteMemberToWsStepRunner = dbosStepRunner,
): Promise<PromoteMemberToWsOutput> {
	const repo = deps.repo ?? createPgRepo(deps.databaseUrl);
	const source = await steps.runStep("loadSource", () => repo.loadSource(input));
	const copied = await steps.runStep("copyRef", () => repo.copyRef(input, source));
	await steps.runStep("copyProvenance", async () => {
		await repo.copyProvenance(input, copied);
		return copied;
	});
	return { sha: copied };
}

let activeDeps: PromoteMemberToWsDeps | null = null;
let registeredWorkflow:
	| ((input: PromoteMemberToWsInput) => Promise<PromoteMemberToWsOutput>)
	| null = null;

export function registerPromoteMemberToWsWorkflow(
	deps: PromoteMemberToWsDeps,
): (input: PromoteMemberToWsInput) => Promise<PromoteMemberToWsOutput> {
	activeDeps = deps;
	if (!registeredWorkflow) {
		registeredWorkflow = DBOS.registerWorkflow(
			async (
				input: PromoteMemberToWsInput,
			): Promise<PromoteMemberToWsOutput> => {
				const currentDeps = activeDeps;
				if (!currentDeps) {
					throw new Error("PromoteMemberToWs deps are not registered");
				}
				return executePromoteMemberToWs(input, currentDeps, dbosStepRunner);
			},
			{
				name: "PromoteMemberToWsV1",
			},
		);
	}
	return registeredWorkflow;
}
