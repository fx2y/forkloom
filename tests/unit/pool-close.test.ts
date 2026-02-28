import { describe, expect, it, vi } from "vitest";
import { createPoolCloseOnce } from "../../apps/api/src/repo/pool-close";

describe("createPoolCloseOnce", () => {
	it("collapses concurrent and repeated close calls into one pool.end", async () => {
		let releaseEnd!: () => void;
		const end = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					releaseEnd = resolve;
				}),
		);
		const close = createPoolCloseOnce({ end });

		const first = close();
		const second = close();
		expect(end).toHaveBeenCalledTimes(1);

		releaseEnd();
		await Promise.all([first, second]);
		await close();

		expect(end).toHaveBeenCalledTimes(1);
	});
});
