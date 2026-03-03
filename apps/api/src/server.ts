import { lstat, readFile } from "node:fs/promises";
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
import { DocService, PgDocRepo, ZaiLayoutClient } from "./doc";
import {
	DbosStepRunner,
	InlineStepRunner,
	launchDbos,
	shutdownDbos,
} from "./durability";
import { buildHealthHandler } from "./http/health";
import { buildApiRouter } from "./http/routes";
import {
	ExtensionService,
	MockPiProviderManager,
	ThemeService,
	buildProviderOverrideRegistry,
	createManagedPiSessionFactory,
	loadMergedPackageSettings,
	probePiSession,
	reconcileMissingPackages,
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
import { SkillService } from "./skill";
import { S3ArtifactStore } from "./storage/s3";
import {
	LazyDbosDocIngestWorkflowLauncher,
	LazyDbosDocOcrWorkflowLauncher,
	createDocOcrQueue,
	registerActorTickWorkflow,
	registerDocOcrWorkflow,
	registerIngestDocWorkflow,
	registerRunOnceWorkflow,
	registerRunSandboxWorkflow,
} from "./workflow";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, "../migrations");
const SANDBOX_PI_CLI_PATH =
	"/runtime/node_modules/@mariozechner/pi-coding-agent/dist/cli.js";

type ThemeNameConfig = {
	theme?: string | undefined;
	themes?: string[] | undefined;
	noThemes?: boolean | undefined;
};

async function readThemeSelectionFromSettings(
	settingsPath: string,
): Promise<ThemeNameConfig> {
	try {
		const raw = await readFile(settingsPath, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			theme: typeof parsed.theme === "string" ? parsed.theme : undefined,
			themes: Array.isArray(parsed.themes)
				? parsed.themes.filter(
						(value): value is string =>
							typeof value === "string" && value.trim().length > 0,
					)
				: undefined,
			noThemes: parsed.noThemes === true,
		};
	} catch {
		return {};
	}
}

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
	const docRepo = new PgDocRepo({
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

	const workflowLauncher = new LazyDbosRunWorkflowLauncher();
	const docService = new DocService({ repo: docRepo });
	const skillService = new SkillService({
		roots: config.skillRoots,
		prefixBytes: config.skillPrefixBytes,
		promptMaxSkills: config.skillPromptMaxSkills,
		promptMaxDescriptionChars: config.skillPromptMaxDescriptionChars,
	});
	const extensionService = new ExtensionService();
	await extensionService.loadAll();
	const providerOverrides = buildProviderOverrideRegistry({
		providers: extensionService.getRegisteredProviders(),
		onWarning: (message) => {
			console.warn(JSON.stringify({ msg: "provider-override-warning", message }));
		},
	});
	const createPiSession = createManagedPiSessionFactory(
		{
			provider: config.piProvider,
			model: config.piModel,
			strictReal: config.piStrictReal,
		},
		{ mockProviderManager, providerOverrides },
	);
	const mergedPackageSettings = await loadMergedPackageSettings({
		globalSettingsPath: config.piGlobalSettingsPath,
		projectSettingsPath: config.piProjectSettingsPath,
	});
	const globalThemeConfig = await readThemeSelectionFromSettings(
		config.piGlobalSettingsPath,
	);
	const projectThemeConfig = await readThemeSelectionFromSettings(
		config.piProjectSettingsPath,
	);
	const themeCandidates = [
		{
			source: "builtin" as const,
			name: "forkloom-default",
			path: resolve(process.cwd(), "apps/api/src/pi/themes/builtin/default.json"),
		},
		...mergedPackageSettings.merged.flatMap((entry) =>
			(entry.themes ?? [])
				.filter((path) => path.endsWith(".json"))
				.map((path) => ({
					source: "package" as const,
					name: path,
					path: resolve(entry.resolved.kind === "local" ? entry.resolved.path : process.cwd(), path),
				})),
		),
		...(globalThemeConfig.themes ?? []).map((path) => ({
			source: "global" as const,
			name: path,
			path: resolve(dirname(config.piGlobalSettingsPath), path),
		})),
		...(projectThemeConfig.themes ?? []).map((path) => ({
			source: "project" as const,
			name: path,
			path: resolve(dirname(config.piProjectSettingsPath), path),
		})),
	];
	const themeService = new ThemeService();
	themeService.setCandidates(themeCandidates);
	themeService.setSelection({
		settingsTheme: projectThemeConfig.theme ?? globalThemeConfig.theme,
		disableThemes: projectThemeConfig.noThemes ?? globalThemeConfig.noThemes,
	});
	await themeService.reloadSelection();
	const startupReconcile = await reconcileMissingPackages({
		entries: mergedPackageSettings.merged,
		isInstalled: async (entry) => {
			if (entry.resolved.kind !== "local") {
				return true;
			}
			try {
				await lstat(entry.resolved.path);
				return true;
			} catch {
				return false;
			}
		},
		install: async () => {
			// npm/git installers are not wired yet; keep deterministic bounded retries.
		},
		maxRetries: 3,
		pollMs: 200,
	});
	console.log(
		JSON.stringify({
			msg: "package-startup-reconcile",
			attempts: startupReconcile.attempts,
			installed: startupReconcile.installed,
			remainingMissing: startupReconcile.remainingMissing,
			activeTheme: themeService.getSnapshot().activeThemeName,
		}),
	);
	const docIngestWorkflowLauncher = new LazyDbosDocIngestWorkflowLauncher();
	const docOcrWorkflowLauncher = new LazyDbosDocOcrWorkflowLauncher();
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
		docs: {
			searchDocs: (input) => docService.searchDocs(input),
			resolveSpan: (span) => docService.resolveSpan(span),
			ingestDoc: (input) => docIngestWorkflowLauncher.startIngestDoc(input),
		},
		skills: skillService,
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
		skills: skillService,
		extensions: extensionService,
		artifactService: workflowArtifactService,
		createPiSession: async (run) =>
			createPiSession({
				model: run.spec.modelPref ?? config.piModel,
			}),
	});
	const runSandboxWorkflow = registerRunSandboxWorkflow({
		runRepo,
		runService,
		skills: skillService,
		extensions: extensionService,
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
					piCommand: config.sandboxRuntimeNodeModulesRoot
						? ["node", SANDBOX_PI_CLI_PATH, "--mode", "rpc"]
						: undefined,
				},
				{ mockProviderManager },
			)(),
	});
	const actorWorkflow = registerActorTickWorkflow({
		repo: actorRepo,
		processor: actorProcessor,
		workflowLauncher: actorWorkflowLauncher,
	});
	const docOcrQueue = createDocOcrQueue({
		workerConcurrency: config.docOcrQueueConcurrency,
		rateLimitPerSecond: config.docOcrQueueRateLimitPerSecond,
	});
	const docOcrWorkflow = registerDocOcrWorkflow({
		repo: docRepo,
		artifactService: workflowArtifactService,
		zaiClient: new ZaiLayoutClient({
			endpoint: config.docOcrEndpoint,
			apiKey: config.docOcrApiKey,
			model: config.docOcrModel,
		}),
		config: {
			model: config.docOcrModel,
		},
	});
	const ingestDocWorkflow = registerIngestDocWorkflow({
		repo: docRepo,
		artifactService: workflowArtifactService,
		ocrWorkflow: docOcrWorkflowLauncher,
		config: {
			endpoint: config.docOcrEndpoint,
			model: config.docOcrModel,
			parserVersion: config.docParserVersion,
			normVersion: config.docNormVersion,
			pdfMaxBytes: config.docLimitPdfBytes,
			pdfMaxPages: config.docLimitPdfPages,
			imageMaxBytes: config.docLimitImageBytes,
		},
	});
	workflowLauncher.bindClassic(runWorkflow);
	workflowLauncher.bindSandbox(runSandboxWorkflow);
	actorWorkflowLauncher.bind(actorWorkflow);
	docIngestWorkflowLauncher.bind(ingestDocWorkflow);
	docOcrWorkflowLauncher.bind(docOcrWorkflow, docOcrQueue);
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

	return {
		app,
		config,
		repo,
		runRepo,
		sandboxRepo,
		actorRepo,
		docRepo,
			actorProcessor,
			extensionService,
			themeService,
		};
	}

async function main(): Promise<void> {
	const {
		app,
		config,
		repo,
		runRepo,
		sandboxRepo,
		actorRepo,
		docRepo,
		actorProcessor,
		extensionService,
		themeService,
	} = await bootstrap();

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
			await docRepo.close();
				await actorProcessor.closeAll();
				await extensionService.unloadAll();
				themeService.close();
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
