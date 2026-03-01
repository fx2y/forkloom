import { DBOS, WorkflowQueue } from "@dbos-inc/dbos-sdk";
import type { RegisteredDocOcrWorkflow } from "./doc-ocr";

export type DocOcrRequest = {
	parseId: string;
};

export type DocOcrQueueConfig = {
	workerConcurrency: number;
	rateLimitPerSecond: number;
};

export interface DocOcrWorkflowLauncher {
	enqueueDocOcr(input: DocOcrRequest): Promise<void>;
}

export function createDocOcrQueue(config: DocOcrQueueConfig): WorkflowQueue {
	if (
		!Number.isInteger(config.workerConcurrency) ||
		config.workerConcurrency < 1
	) {
		throw new Error("invalid doc OCR queue workerConcurrency");
	}
	if (
		!Number.isInteger(config.rateLimitPerSecond) ||
		config.rateLimitPerSecond < 1
	) {
		throw new Error("invalid doc OCR queue rateLimitPerSecond");
	}
	return new WorkflowQueue("doc_ocr_q", {
		workerConcurrency: config.workerConcurrency,
		rateLimit: {
			limitPerPeriod: config.rateLimitPerSecond,
			periodSec: 1,
		},
	});
}

export function toDocOcrWorkflowId(parseId: string): string {
	if (!parseId) {
		throw new Error("parseId is required");
	}
	return `doc_ocr:${parseId}`;
}

export class DbosDocOcrWorkflowLauncher implements DocOcrWorkflowLauncher {
	constructor(
		private readonly workflow: RegisteredDocOcrWorkflow,
		private readonly queue: WorkflowQueue,
	) {}

	async enqueueDocOcr(input: DocOcrRequest): Promise<void> {
		await DBOS.startWorkflow(this.workflow, {
			queueName: this.queue.name,
			workflowID: toDocOcrWorkflowId(input.parseId),
		})(input.parseId);
	}
}

export class LazyDbosDocOcrWorkflowLauncher implements DocOcrWorkflowLauncher {
	private inner: DocOcrWorkflowLauncher | null = null;

	bind(workflow: RegisteredDocOcrWorkflow, queue: WorkflowQueue): void {
		this.inner = new DbosDocOcrWorkflowLauncher(workflow, queue);
	}

	async enqueueDocOcr(input: DocOcrRequest): Promise<void> {
		if (!this.inner) {
			throw new Error("Doc OCR workflow is not registered");
		}
		await this.inner.enqueueDocOcr(input);
	}
}
