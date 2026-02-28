import {
	MockPiProviderManager,
	createManagedPiSessionFactory,
} from "../../apps/api/src/pi";
import { writeJson } from "./live-support";

async function main(): Promise<void> {
	const mockProviderManager = new MockPiProviderManager();
	const createSession = createManagedPiSessionFactory(
		{
			provider: process.env.PI_PROVIDER ?? "github-copilot",
			model: process.env.PI_MODEL ?? "gpt-4.1",
			strictReal: process.env.PI_RPC_STRICT_REAL === "1",
		},
		{ mockProviderManager },
	);
	const session = await createSession();
	try {
		await session.setQueueMode({
			followUpMode: "one-at-a-time",
			steeringMode: "one-at-a-time",
		});
		await session.prompt({ message: "reply with a short sentence" });
		const stateAfterPrompt = await session.getState();
		await session.steer("interrupt after the current step");
		await session.followUp("then say done");

		let eventCount = 0;
		await session.waitUntilIdle({
			onEvent: async () => {
				eventCount += 1;
			},
		});
		const finalState = await session.getState();
		await writeJson(".cache/test-int/actor-steer-live.json", {
			stateAfterPrompt,
			finalState,
			eventCount,
			lastAssistantText: await session.getLastAssistantText(),
		});
	} finally {
		await session.close();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
