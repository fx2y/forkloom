import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	ActorEvent,
	ActorSpec,
	ActorState,
	MailboxPost,
} from "@forkloom/contracts";
import {
	JsonEventStream as SharedJsonEventStream,
	type SseReadResult,
	apiOrigin,
	readJson,
	writeJson,
} from "./live-support";

const execFileAsync = promisify(execFile);

export function makeActorSpec(actorId: string, name = "ops"): ActorSpec {
	return {
		actorId,
		name,
	};
}

export async function createActor(spec: ActorSpec): Promise<ActorState> {
	const response = await fetch(`${apiOrigin()}/actors`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(spec),
	});
	return readJson<ActorState>(response, `create actor ${spec.actorId}`);
}

export async function fetchActorState(actorId: string): Promise<ActorState> {
	const response = await fetch(`${apiOrigin()}/actors/${actorId}`);
	return readJson<ActorState>(response, `fetch actor ${actorId}`);
}

export async function postActorMessage(
	actorId: string,
	payload: MailboxPost,
): Promise<ActorEvent> {
	const response = await fetch(`${apiOrigin()}/actors/${actorId}/messages`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	return readJson<ActorEvent>(response, `post actor message ${actorId}`);
}

export async function uploadArtifact(input: {
	body: string;
	filename: string;
	mime?: string | undefined;
}) {
	const form = new FormData();
	form.set(
		"file",
		new Blob([input.body], { type: input.mime ?? "text/plain" }),
		input.filename,
	);
	const response = await fetch(`${apiOrigin()}/artifacts`, {
		method: "POST",
		body: form,
	});
	return readJson<{ sha256: string }>(response, `upload ${input.filename}`);
}

export async function waitForApiReady(timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${apiOrigin()}/health`);
			if (response.ok) {
				return;
			}
		} catch {
			// keep polling until the deadline
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error("api did not become healthy after restart");
}

export async function restartApi(): Promise<void> {
	await execFileAsync("docker", ["compose", "restart", "api"]);
	await waitForApiReady();
}

export class ActorEventStream {
	private readonly stream: SharedJsonEventStream<ActorEvent>;

	constructor(
		actorId: string,
		options: {
			sinceEventId?: number | undefined;
			lastEventId?: number | undefined;
		} = {},
	) {
		this.stream = new SharedJsonEventStream(
			`${apiOrigin()}/actors/${actorId}/events`,
			(frame) =>
				frame.event && frame.data && frame.event !== "gap"
					? (JSON.parse(frame.data) as ActorEvent)
					: null,
			{
				sinceEventId: options.sinceEventId,
				lastEventId: options.lastEventId,
				timeoutLabel: "actor SSE",
			},
		);
	}

	async readUntil(
		stopWhen: (current: SseReadResult<ActorEvent>) => boolean,
		timeoutMs = 30_000,
	) {
		return this.stream.readUntil(stopWhen, timeoutMs);
	}

	close(): void {
		this.stream.close();
	}
}

export { writeJson };
