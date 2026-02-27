import { randomUUID } from "node:crypto";
import { DBOS } from "@dbos-inc/dbos-sdk";

export interface StepRunner {
	runStep<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

let dbosLaunched = false;
const pendingStepFns = new Map<string, () => Promise<unknown>>();

const PendingStepWorkflow = DBOS.registerWorkflow(
	async (token: string, stepName: string): Promise<unknown> => {
		const fn = pendingStepFns.get(token);
		if (!fn) {
			throw new Error(`missing pending step function: ${token}`);
		}
		return DBOS.runStep(fn, { name: stepName });
	},
	{
		name: "forkloomPendingStepWorkflow",
	},
);

export class InlineStepRunner implements StepRunner {
	async runStep<T>(_name: string, fn: () => Promise<T>): Promise<T> {
		return fn();
	}
}

export class DbosStepRunner implements StepRunner {
	async runStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
		const token = randomUUID();
		const workflowID = `forkloom-step-${token}`;
		pendingStepFns.set(token, fn as () => Promise<unknown>);
		try {
			const handle = await DBOS.startWorkflow(PendingStepWorkflow, {
				workflowID,
			})(token, name);
			const result = await handle.getResult();
			return result as T;
		} finally {
			pendingStepFns.delete(token);
		}
	}
}

export async function launchDbos(systemDatabaseUrl: string): Promise<void> {
	if (dbosLaunched) {
		return;
	}
	DBOS.setConfig({
		systemDatabaseUrl,
		runAdminServer: false,
	});
	await DBOS.launch();
	dbosLaunched = true;
}

export async function shutdownDbos(): Promise<void> {
	if (!dbosLaunched) {
		return;
	}
	await DBOS.shutdown({ deregister: true });
	dbosLaunched = false;
}
