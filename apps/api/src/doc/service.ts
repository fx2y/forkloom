import type { DocRepo, RecordParseLedgerInput } from "./ports";

export type DocServiceDeps = {
	repo: DocRepo;
};

export class DocService {
	constructor(private readonly deps: DocServiceDeps) {}

	async recordParseLedger(input: RecordParseLedgerInput): Promise<void> {
		await this.deps.repo.recordParseLedger(input);
	}
}
