import { open, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { hashBytes } from "@forkloom/shared";
import { parseSkillFrontmatterPrefix } from "./frontmatter";
import {
	SKILL_SCOPE_PRECEDENCE,
	type SkillFrontmatter,
	type SkillIndexEntry,
	type SkillRegistryState,
	type SkillRegistryWarning,
	type SkillRoot,
	type SkillScope,
} from "./types";

type PrefixReader = (path: string, maxBytes: number) => Promise<Buffer>;

type CachedFrontmatter = {
	mtimeMs: number;
	size: number;
	prefixHash: string;
	frontmatter: SkillFrontmatter | null;
};

export type SkillRegistryOptions = {
	roots: SkillRoot[];
	prefixBytes: number;
	readPrefix?: PrefixReader | undefined;
};

type BuildContext = {
	warnings: SkillRegistryWarning[];
	entriesByName: Map<string, SkillIndexEntry>;
};

const SKILL_FILE_NAME = "SKILL.md";
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class SkillRegistry {
	private readonly roots: SkillRoot[];
	private readonly prefixBytes: number;
	private readonly readPrefix: PrefixReader;
	private readonly frontmatterCache = new Map<string, CachedFrontmatter>();

	constructor(options: SkillRegistryOptions) {
		this.roots = orderRoots(options.roots);
		this.prefixBytes = options.prefixBytes;
		this.readPrefix = options.readPrefix ?? readPrefixBytes;
	}

	async build(): Promise<SkillRegistryState> {
		const ctx: BuildContext = {
			warnings: [],
			entriesByName: new Map(),
		};

		for (const root of this.roots) {
			if (!(await isDirectory(root.path))) {
				continue;
			}
			const discovered = await discoverSkillFiles(root.path);
			for (const path of discovered) {
				await this.readCandidate(root, path, ctx);
			}
		}

		const entries = [...ctx.entriesByName.values()].sort(compareSkillEntries);
		return {
			entries,
			warnings: ctx.warnings,
		};
	}

	private async readCandidate(
		root: SkillRoot,
		path: string,
		ctx: BuildContext,
	): Promise<void> {
		const cached = await this.getFrontmatter(path, root.scope, ctx);
		if (!cached) {
			return;
		}
		if (!cached.frontmatter) {
			pushWarning(ctx, {
				code: "frontmatter_missing",
				message: "missing or truncated YAML frontmatter in prefix window",
				path,
				scope: root.scope,
			});
			return;
		}
		const frontmatter = cached.frontmatter;
		const description = frontmatter.description?.trim();
		if (!description) {
			pushWarning(ctx, {
				code: "description_missing",
				message: "missing description; skill dropped from registry",
				path,
				scope: root.scope,
			});
			return;
		}
		if (description.length > 1024) {
			pushWarning(ctx, {
				code: "description_len",
				message: "description exceeds 1024 chars; keeping with warning",
				path,
				scope: root.scope,
			});
		}
		const expectedName = inferExpectedName(path);
		const name = frontmatter.name ?? expectedName;
		validateName(name, expectedName, path, root.scope, ctx);
		const existing = ctx.entriesByName.get(name);
		if (existing) {
			pushWarning(ctx, {
				code: "collision",
				message: `collision on "${name}" (first-wins by precedence/order)`,
				path,
				scope: root.scope,
				name,
				existingPath: existing.path,
			});
			return;
		}
		ctx.entriesByName.set(name, {
			skillId: name,
			name,
			description,
			path,
			scope: root.scope,
			hidden: frontmatter.disableModelInvocation,
			menuVisible: frontmatter.userInvocable,
			allowedTools: frontmatter.allowedTools,
			version: frontmatter.version,
			hash: cached.prefixHash,
		});
	}

	private async getFrontmatter(
		path: string,
		scope: SkillScope,
		ctx: BuildContext,
	): Promise<CachedFrontmatter | null> {
		let fileStat: Awaited<ReturnType<typeof stat>> | null = null;
		try {
			fileStat = await stat(path);
		} catch (error) {
			pushWarning(ctx, {
				code: "read_error",
				message: `stat failed: ${String(error)}`,
				path,
				scope,
			});
			return null;
		}
		if (!fileStat.isFile()) {
			return null;
		}
		const cached = this.frontmatterCache.get(path);
		if (
			cached &&
			cached.mtimeMs === fileStat.mtimeMs &&
			cached.size === fileStat.size
		) {
			return cached;
		}
		let prefix: Buffer;
		try {
			prefix = await this.readPrefix(path, this.prefixBytes);
		} catch (error) {
			pushWarning(ctx, {
				code: "read_error",
				message: `read prefix failed: ${String(error)}`,
				path,
				scope,
			});
			return null;
		}
		const prefixHash = hashBytes(prefix);
		if (cached && cached.prefixHash === prefixHash) {
			const refreshed: CachedFrontmatter = {
				...cached,
				mtimeMs: fileStat.mtimeMs,
				size: fileStat.size,
			};
			this.frontmatterCache.set(path, refreshed);
			return refreshed;
		}
		const next: CachedFrontmatter = {
			mtimeMs: fileStat.mtimeMs,
			size: fileStat.size,
			prefixHash,
			frontmatter: parseSkillFrontmatterPrefix(prefix.toString("utf8")),
		};
		this.frontmatterCache.set(path, next);
		return next;
	}
}

async function discoverSkillFiles(rootPath: string): Promise<string[]> {
	const files: string[] = [];
	const seen = new Set<string>();
	await walkSkillTree(rootPath, 0, files, seen);
	return files;
}

async function walkSkillTree(
	dirPath: string,
	depth: number,
	out: string[],
	seen: Set<string>,
): Promise<void> {
	let entries: Awaited<ReturnType<typeof readdir>> = [];
	try {
		entries = await readdir(dirPath, { withFileTypes: true });
	} catch {
		return;
	}
	entries.sort((left, right) => left.name.localeCompare(right.name));
	const childDirs: string[] = [];
	for (const entry of entries) {
		const abs = resolve(dirPath, entry.name);
		if (entry.isDirectory()) {
			childDirs.push(abs);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const isDirectMarkdown =
			depth === 0 && entry.name.toLowerCase().endsWith(".md");
		const isSkillFile = entry.name === SKILL_FILE_NAME;
		if (!isDirectMarkdown && !isSkillFile) {
			continue;
		}
		if (!seen.has(abs)) {
			seen.add(abs);
			out.push(abs);
		}
	}
	for (const childDir of childDirs) {
		await walkSkillTree(childDir, depth + 1, out, seen);
	}
}

function inferExpectedName(path: string): string {
	const baseName = basename(path);
	if (baseName === SKILL_FILE_NAME) {
		return basename(dirname(path));
	}
	return basename(path, extname(path));
}

function validateName(
	name: string,
	expectedName: string,
	path: string,
	scope: SkillScope,
	ctx: BuildContext,
): void {
	if (name.length < 1 || name.length > 64) {
		pushWarning(ctx, {
			code: "name_len",
			message: "name length must be 1..64",
			path,
			scope,
			name,
		});
	}
	if (!SKILL_NAME_PATTERN.test(name)) {
		pushWarning(ctx, {
			code: "name_chars",
			message: "name should match ^[a-z0-9]+(-[a-z0-9]+)*$",
			path,
			scope,
			name,
		});
	}
	if (name.includes("--")) {
		pushWarning(ctx, {
			code: "name_double_dash",
			message: "name should not contain --",
			path,
			scope,
			name,
		});
	}
	if (name !== expectedName) {
		pushWarning(ctx, {
			code: "name_dir_mismatch",
			message: `name "${name}" differs from expected "${expectedName}"`,
			path,
			scope,
			name,
		});
	}
}

function pushWarning(ctx: BuildContext, warning: SkillRegistryWarning): void {
	ctx.warnings.push(warning);
}

function compareSkillEntries(
	left: SkillIndexEntry,
	right: SkillIndexEntry,
): number {
	const scopeOrder =
		SKILL_SCOPE_PRECEDENCE.indexOf(left.scope) -
		SKILL_SCOPE_PRECEDENCE.indexOf(right.scope);
	if (scopeOrder !== 0) {
		return scopeOrder;
	}
	const nameOrder = left.name.localeCompare(right.name);
	if (nameOrder !== 0) {
		return nameOrder;
	}
	return left.path.localeCompare(right.path);
}

function orderRoots(roots: SkillRoot[]): SkillRoot[] {
	return roots
		.map((root, index) => ({
			root,
			index,
		}))
		.sort((left, right) => {
			const scopeOrder =
				SKILL_SCOPE_PRECEDENCE.indexOf(left.root.scope) -
				SKILL_SCOPE_PRECEDENCE.indexOf(right.root.scope);
			if (scopeOrder !== 0) {
				return scopeOrder;
			}
			return left.index - right.index;
		})
		.map((item) => item.root);
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

export async function readPrefixBytes(
	path: string,
	maxBytes: number,
): Promise<Buffer> {
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(maxBytes);
		const read = await handle.read(buffer, 0, maxBytes, 0);
		return buffer.subarray(0, read.bytesRead);
	} finally {
		await handle.close();
	}
}
