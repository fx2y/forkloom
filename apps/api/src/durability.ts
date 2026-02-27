import { DBOS } from "@dbos-inc/dbos-sdk";

export interface StepRunner {
	runStep<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export class InlineStepRunner implements StepRunner {
	async runStep<T>(_name: string, fn: () => Promise<T>): Promise<T> {
		return fn();
	}
}

export class DbosStepRunner implements StepRunner {
	async runStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
		return DBOS.runStep(fn, { name });
	}
}
