import { DBOS } from "@dbos-inc/dbos-sdk";
import { buildDocSha } from "../doc";
import type {
	IngestDocOutput,
	IngestDocWorkflowInput,
	RegisteredIngestDocWorkflow,
} from "./doc-ingest";

export type DocIngestRequest = {
	body: Buffer;
	mime: string;
};

export interface DocIngestWorkflowLauncher {
	startIngestDoc(
		input: DocIngestRequest,
		opts?: { workflowID?: string | undefined },
	): Promise<IngestDocOutput>;
}

function toBodyBase64(body: Buffer): string {
	if (body.byteLength === 0) {
		throw new Error("doc ingest body is empty");
	}
	return body.toString("base64");
}

function toDefaultWorkflowId(input: DocIngestRequest): string {
	const docSha = buildDocSha(input.body);
	return `doc_ingest:${docSha}:${Date.now()}`;
}

export class DbosDocIngestWorkflowLauncher
	implements DocIngestWorkflowLauncher
{
	constructor(private readonly workflow: RegisteredIngestDocWorkflow) {}

	async startIngestDoc(
		input: DocIngestRequest,
		opts?: { workflowID?: string | undefined },
	): Promise<IngestDocOutput> {
		const workflowID = opts?.workflowID ?? toDefaultWorkflowId(input);
		const payload: IngestDocWorkflowInput = {
			bodyBase64: toBodyBase64(input.body),
			mime: input.mime,
		};
		const handle = await DBOS.startWorkflow(this.workflow, { workflowID })(
			payload,
		);
		return handle.getResult();
	}
}

export class LazyDbosDocIngestWorkflowLauncher
	implements DocIngestWorkflowLauncher
{
	private inner: DocIngestWorkflowLauncher | null = null;

	bind(workflow: RegisteredIngestDocWorkflow): void {
		this.inner = new DbosDocIngestWorkflowLauncher(workflow);
	}

	async startIngestDoc(
		input: DocIngestRequest,
		opts?: { workflowID?: string | undefined },
	): Promise<IngestDocOutput> {
		if (!this.inner) {
			throw new Error("Doc ingest workflow is not registered");
		}
		return this.inner.startIngestDoc(input, opts);
	}
}
