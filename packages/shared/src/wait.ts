export async function waitFor(
	name: string,
	predicate: () => Promise<boolean>,
	tries = 60,
	intervalMs = 1_000,
): Promise<void> {
	for (let index = 0; index < tries; index += 1) {
		if (await predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	throw new Error(`${name} is not ready after ${tries * (intervalMs / 1000)}s`);
}
