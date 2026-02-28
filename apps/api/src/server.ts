import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitFor } from "@forkloom/shared";
import { loadConfig } from "./config";
import {
	DbosStepRunner,
	InlineStepRunner,
	launchDbos,
	shutdownDbos,
} from "./durability";
import { buildHealthHandler } from "./http/health";
import { buildApiRouter } from "./http/routes";
import {
	MockPiProviderManager,
	createManagedPiSessionFactory,
	probePiSession,
} from "./pi";
import { PgArtifactRepo } from "./repo/postgres";
import { LazyDbosRunWorkflowLauncher, PgRunRepo, RunService } from "./run";
import { ArtifactService } from "./service";
import { S3ArtifactStore } from "./storage/s3";
import { registerRunOnceWorkflow } from "./workflow";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, "../migrations");

async function bootstrap() {
	const config = loadConfig();
	const repo = new PgArtifactRepo({
		databaseUrl: config.databaseUrl,
		migrationsDir,
	});
	const runRepo = new PgRunRepo({
		databaseUrl: config.databaseUrl,
	});
	const store = new S3ArtifactStore({
		endpoint: config.s3Endpoint,
		bucket: config.s3Bucket,
		region: config.s3Region,
		accessKeyId: config.awsAccessKeyId,
		secretAccessKey: config.awsSecretAccessKey,
	});

	await waitFor("postgres", () => repo.ping());
	await repo.runMigrations();
	await waitFor("s3 bucket", async () => {
		try {
			await store.ensureBucket();
			return true;
		} catch {
			return false;
		}
	});

	const service = new ArtifactService({
		repo,
		store,
		s3Bucket: config.s3Bucket,
		stepRunner: new DbosStepRunner(),
	});
	const workflowArtifactService = new ArtifactService({
		repo,
		store,
		s3Bucket: config.s3Bucket,
		stepRunner: new InlineStepRunner(),
	});
	const mockProviderManager = new MockPiProviderManager();
	const createPiSession = createManagedPiSessionFactory(
		{
			provider: config.piProvider,
			model: config.piModel,
			strictReal: config.piStrictReal,
		},
		{ mockProviderManager },
	);

	const workflowLauncher = new LazyDbosRunWorkflowLauncher();
	const runService = new RunService({ runRepo, workflowLauncher });
	const runWorkflow = registerRunOnceWorkflow({
		runRepo,
		runService,
		artifactService: workflowArtifactService,
		createPiSession: async (run) =>
			createPiSession({
				model: run.spec.modelPref ?? config.piModel,
			}),
	});
	workflowLauncher.bind(runWorkflow);
	await launchDbos(config.databaseUrl);

	const app = buildApiRouter({ artifactService: service, runService });
	app.get(
		"/health",
		buildHealthHandler({
			repo,
			store,
			pingPi: () => probePiSession(createPiSession),
		}),
	);

	return { app, config, repo, runRepo };
}

async function main(): Promise<void> {
	const { app, config, repo, runRepo } = await bootstrap();

	const server = app.listen(config.port, () => {
		const payload = {
			msg: "api booted",
			port: config.port,
			deps: {
				pg: config.databaseUrl,
				s3: config.s3Endpoint,
				pi: config.piRpcUrl,
			},
		};
		console.log(JSON.stringify(payload));
	});

	const close = async () => {
		server.close();
		await repo.close();
		await runRepo.close();
		await shutdownDbos();
	};

	process.on("SIGTERM", () => {
		void close();
	});
	process.on("SIGINT", () => {
		void close();
	});
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
