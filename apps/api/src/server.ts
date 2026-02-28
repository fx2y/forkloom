import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitFor } from "@forkloom/shared";
import {
	ActorService,
	LazyDbosActorWorkflowLauncher,
	PgActorRepo,
	PiActorBatchProcessor,
	buildActorPromptInput,
} from "./actor";
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
import {
	LazyDbosRunWorkflowLauncher,
	PgRunRepo,
	RunService,
	createRunPlan,
} from "./run";
import {
	DockerBackend,
	PgSandboxRepo,
	createSandboxPiSessionFactory,
} from "./sandbox";
import { ArtifactService } from "./service";
import { S3ArtifactStore } from "./storage/s3";
import { registerActorTickWorkflow, registerRunOnceWorkflow } from "./workflow";

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
	const sandboxRepo = new PgSandboxRepo({
		databaseUrl: config.databaseUrl,
	});
	const actorRepo = new PgActorRepo({
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
	const workflowSandboxBackend = new DockerBackend({
		writeSnapshot: async (body, meta) => {
			const artifact = await workflowArtifactService.putArtifact({
				body,
				mime: "application/gzip",
				type: "raw",
				meta: {
					"run.sandbox": meta.sandboxId,
					"workspace.include": meta.include.join(","),
					"workspace.exclude": meta.exclude.join(","),
				},
			});
			return { sha256: artifact.sha256 };
		},
	});
	const runService = new RunService({
		runRepo,
		workflowLauncher,
		sandbox: {
			sandboxRepo,
			createRunPlan: (spec) => createRunPlan(spec, config),
			artifactService: workflowArtifactService,
		},
	});
	const actorWorkflowLauncher = new LazyDbosActorWorkflowLauncher();
	const actorService = new ActorService({
		repo: actorRepo,
		workflowLauncher: actorWorkflowLauncher,
	});
	const actorProcessor = new PiActorBatchProcessor({
		createPiSession: async (actor) =>
			createPiSession({
				model: config.piModel,
				sessionPath: actor.piSessionFile ?? undefined,
			}),
		buildPromptInput: (actor, message) =>
			buildActorPromptInput(actor, message, workflowArtifactService),
	});
	const runWorkflow = registerRunOnceWorkflow({
		runRepo,
		runService,
		artifactService: workflowArtifactService,
		sandbox: {
			runRepo,
			runService,
			artifactService: workflowArtifactService,
			sandboxRepo,
			backend: workflowSandboxBackend,
			workflowLauncher,
			createPiSession: async (run, sandbox) =>
				createSandboxPiSessionFactory(
					{
						containerName: sandbox.containerName,
						cwd: sandbox.spec.workdir,
						homeHostDir: sandbox.spec.piHomeHostDir,
						homePath: sandbox.spec.piHomePath,
						provider: config.piProvider,
						model: run.spec.modelPref ?? config.piModel,
						sessionPath: `${sandbox.spec.piHomePath}/.pi/agent/sessions/${run.runId}.jsonl`,
						strictReal: config.piStrictReal,
					},
					{ mockProviderManager },
				)(),
		},
		createPiSession: async (run) =>
			createPiSession({
				model: run.spec.modelPref ?? config.piModel,
			}),
	});
	const actorWorkflow = registerActorTickWorkflow({
		repo: actorRepo,
		processor: actorProcessor,
		workflowLauncher: actorWorkflowLauncher,
	});
	workflowLauncher.bind(runWorkflow);
	actorWorkflowLauncher.bind(actorWorkflow);
	await launchDbos(config.databaseUrl);

	const app = buildApiRouter({
		artifactService: service,
		actorService,
		runService,
	});
	app.get(
		"/health",
		buildHealthHandler({
			repo,
			store,
			pingPi: () =>
				probePiSession((overrides) =>
					createPiSession({ ...overrides, bootstrapTimeoutMs: 2_000 }),
				),
		}),
	);

	return { app, config, repo, runRepo, sandboxRepo, actorRepo, actorProcessor };
}

async function main(): Promise<void> {
	const {
		app,
		config,
		repo,
		runRepo,
		sandboxRepo,
		actorRepo,
		actorProcessor,
	} =
		await bootstrap();

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

	let closing: Promise<void> | null = null;
	const close = async () => {
		if (closing) {
			return closing;
		}
		closing = (async () => {
			await new Promise<void>((resolveClose) => {
				server.close(() => resolveClose());
			});
			await repo.close();
			await runRepo.close();
			await sandboxRepo.close();
			await actorRepo.close();
			await actorProcessor.closeAll();
			await shutdownDbos();
		})();
		return closing;
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
