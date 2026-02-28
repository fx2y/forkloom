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
	queryRows,
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

type ActorEventRow = {
	kind: string;
	payload: Record<string, unknown> | null;
};

export type ActorProofProvenance = {
	strictReal: boolean;
	provider: string | null;
	model: string | null;
	fallbackUsed: boolean;
	piEventCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function findProviderModel(value: unknown): {
	provider: string | null;
	model: string | null;
} | null {
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findProviderModel(item);
			if (found?.provider || found?.model) {
				return found;
			}
		}
		return null;
	}
	if (!isRecord(value)) {
		return null;
	}

	const provider = typeof value.provider === "string" ? value.provider : null;
	const model = typeof value.model === "string" ? value.model : null;
	if (provider || model) {
		return { provider, model };
	}

	for (const nested of Object.values(value)) {
		const found = findProviderModel(nested);
		if (found?.provider || found?.model) {
			return found;
		}
	}
	return null;
}

function isMockProvenance(input: {
	provider: string | null;
	model: string | null;
	sessionFile?: string | null | undefined;
}): boolean {
	return Boolean(
		input.provider?.startsWith("forkloom-mock") ||
			input.model?.includes("forkloom-mock") ||
			input.sessionFile?.startsWith("/tmp/forkloom-pi-home-"),
	);
}

export async function loadActorProofProvenance(input: {
	actorId: string;
	sessionFile?: string | null | undefined;
	requireProviderModel?: boolean | undefined;
}): Promise<ActorProofProvenance> {
	const rows = await queryRows<ActorEventRow>(
		`select kind, payload
		 from actor_event
		 where actor_id = $1
		 order by seq asc`,
		[input.actorId],
	);
	const strictReal = process.env.PI_RPC_STRICT_REAL === "1";
	const piRows = rows.filter((row) => row.kind === "pi_event");
	const providerModel =
		piRows
			.map((row) => findProviderModel(row.payload))
			.find((value) => value?.provider || value?.model) ?? null;
	let provider = providerModel?.provider ?? null;
	let model = providerModel?.model ?? null;
	const fallbackUsed = isMockProvenance({
		provider,
		model,
		sessionFile: input.sessionFile,
	});
	if (!provider) {
		provider = fallbackUsed
			? "forkloom-mock"
			: (process.env.PI_PROVIDER ?? null);
	}
	if (!model) {
		model = fallbackUsed
			? "forkloom-mock/forkloom-mock-1"
			: (process.env.PI_MODEL ?? null);
	}

	if (strictReal && fallbackUsed) {
		throw new Error(
			`strict-real proof fell back to mock provider for actor ${input.actorId}`,
		);
	}
	if (
		strictReal &&
		input.requireProviderModel !== false &&
		(!provider || !model)
	) {
		throw new Error(
			`strict-real proof missing provider/model provenance for actor ${input.actorId}`,
		);
	}

	return {
		strictReal,
		provider,
		model,
		fallbackUsed,
		piEventCount: piRows.length,
	};
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
