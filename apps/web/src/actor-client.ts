import type {
	ActorEvent,
	ActorSpec,
	ActorState,
	MailboxPost,
} from "@forkloom/contracts";

export type EventSourceLike = {
	addEventListener(
		name: string,
		listener: (event: MessageEvent<string>) => void,
	): void;
	close(): void;
	onerror: ((event: Event) => void) | null;
};

export type UploadedAttachment = {
	name: string;
	sha256: string;
};

export type AppDeps = {
	fetchImpl: typeof fetch;
	createEventSource(url: string): EventSourceLike;
};

function browserDeps(): AppDeps {
	return {
		fetchImpl: fetch,
		createEventSource: (url) => new EventSource(url),
	};
}

async function readJson<T>(response: Response, label: string): Promise<T> {
	if (!response.ok) {
		throw new Error(`${label} failed (${response.status})`);
	}
	return (await response.json()) as T;
}

export function buildActorEventsUrl(
	actorId: string,
	sinceEventId: number,
): string {
	const query =
		sinceEventId > 0
			? `?since=${encodeURIComponent(String(sinceEventId))}`
			: "";
	return `/actors/${actorId}/events${query}`;
}

export async function listActors(
	fetchImpl: typeof fetch,
): Promise<ActorState[]> {
	const response = await fetchImpl("/actors");
	return readJson<ActorState[]>(response, "list actors");
}

export async function fetchActor(
	fetchImpl: typeof fetch,
	actorId: string,
): Promise<ActorState> {
	const response = await fetchImpl(`/actors/${actorId}`);
	return readJson<ActorState>(response, `fetch actor ${actorId}`);
}

export async function createActor(
	fetchImpl: typeof fetch,
	spec: ActorSpec,
): Promise<ActorState> {
	const response = await fetchImpl("/actors", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(spec),
	});
	return readJson<ActorState>(response, `create actor ${spec.actorId}`);
}

export async function postActorMessage(
	fetchImpl: typeof fetch,
	actorId: string,
	payload: MailboxPost,
): Promise<ActorEvent> {
	const response = await fetchImpl(`/actors/${actorId}/messages`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	return readJson<ActorEvent>(response, `post actor message ${actorId}`);
}

export async function uploadAttachments(
	fetchImpl: typeof fetch,
	files: File[],
): Promise<UploadedAttachment[]> {
	const uploaded: UploadedAttachment[] = [];
	for (const file of files) {
		const body = new FormData();
		body.set("file", file);
		const response = await fetchImpl("/artifacts", {
			method: "POST",
			body,
		});
		const payload = await readJson<{ sha256: string }>(
			response,
			`upload ${file.name}`,
		);
		uploaded.push({
			name: file.name,
			sha256: payload.sha256,
		});
	}
	return uploaded;
}

export { browserDeps };
