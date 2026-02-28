type PoolEndLike = {
	end(): Promise<void>;
};

export function createPoolCloseOnce(pool: PoolEndLike): () => Promise<void> {
	let closing: Promise<void> | null = null;
	return async () => {
		if (!closing) {
			closing = pool.end();
		}
		await closing;
	};
}
