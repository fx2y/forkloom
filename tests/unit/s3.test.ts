import { describe, expect, it, vi } from "vitest";
import { S3ArtifactStore } from "../../apps/api/src/storage/s3";

function createStore(send: (command: unknown) => Promise<unknown>) {
	return new S3ArtifactStore({
		endpoint: "http://127.0.0.1:8333",
		bucket: "agentos",
		region: "us-east-1",
		accessKeyId: "key",
		secretAccessKey: "secret",
		client: { send },
	});
}

describe("S3ArtifactStore.ensureBucket", () => {
	it("creates the bucket when head reports missing", async () => {
		const send = vi
			.fn<(command: unknown) => Promise<unknown>>()
			.mockRejectedValueOnce({
				name: "NotFound",
				$metadata: { httpStatusCode: 404 },
			})
			.mockResolvedValueOnce({});
		const store = createStore(send);

		await expect(store.ensureBucket()).resolves.toBeUndefined();
		expect(send).toHaveBeenCalledTimes(2);
	});

	it("swallows bucket-already-exists races only", async () => {
		const send = vi
			.fn<(command: unknown) => Promise<unknown>>()
			.mockRejectedValueOnce({
				name: "NoSuchBucket",
				$metadata: { httpStatusCode: 404 },
			})
			.mockRejectedValueOnce({
				name: "BucketAlreadyOwnedByYou",
				$metadata: { httpStatusCode: 409 },
			});
		const store = createStore(send);

		await expect(store.ensureBucket()).resolves.toBeUndefined();
	});

	it("rethrows unreachable endpoint errors", async () => {
		const send = vi
			.fn<(command: unknown) => Promise<unknown>>()
			.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:1"));
		const store = createStore(send);

		await expect(store.ensureBucket()).rejects.toThrow("ECONNREFUSED");
	});
});
