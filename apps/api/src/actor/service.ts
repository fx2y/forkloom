import type {
	ActorEventModel,
	ActorRepo,
	ActorSpecModel,
	ActorStateModel,
	ActorWorkflowLauncher,
	MailboxPostModel,
} from "./ports";

export type ActorServiceDeps = {
	repo: ActorRepo;
	workflowLauncher: ActorWorkflowLauncher;
};

function normalizeMailboxText(text: string): string {
	const normalized = text.trim();
	if (normalized.length === 0) {
		throw new Error("message text is required");
	}
	if (/^\s*\//.test(normalized)) {
		throw new Error("mailbox commands are forbidden");
	}
	return normalized;
}

export class ActorService {
	constructor(private readonly deps: ActorServiceDeps) {}

	createActor(spec: ActorSpecModel): Promise<ActorStateModel> {
		return this.deps.repo.createActor(spec);
	}

	listActors(): Promise<ActorStateModel[]> {
		return this.deps.repo.listActors();
	}

	getActorState(actorId: string): Promise<ActorStateModel | null> {
		return this.deps.repo.getActorState(actorId);
	}

	async sendMessage(input: MailboxPostModel): Promise<ActorEventModel> {
		const message = await this.deps.repo.postMailboxMessage({
			...input,
			text: normalizeMailboxText(input.text),
		});
		await this.deps.workflowLauncher.enqueueActorTick(input.actorId);
		return message;
	}
}

export { normalizeMailboxText };
