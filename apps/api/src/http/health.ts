import type { Request, Response } from "express";
import type { ArtifactRepo, ArtifactStore } from "../ports";

type HealthDeps = {
	repo: ArtifactRepo;
	store: ArtifactStore;
	piRpcUrl: string;
};

async function pingPi(url: string): Promise<boolean> {
	if (url.startsWith("stdio://")) {
		return true;
	}
	try {
		const response = await fetch(`${url}/health`);
		return response.ok;
	} catch {
		return false;
	}
}

export function buildHealthHandler(deps: HealthDeps) {
	return async (_req: Request, res: Response): Promise<void> => {
		const [pg, s3, pi] = await Promise.all([
			deps.repo.ping(),
			deps.store.ping(),
			pingPi(deps.piRpcUrl),
		]);

		const payload = {
			ok: pg && s3 && pi,
			deps: {
				pg,
				s3,
				pi,
				api: true,
			},
		};

		res.status(payload.ok ? 200 : 503).json(payload);
	};
}
