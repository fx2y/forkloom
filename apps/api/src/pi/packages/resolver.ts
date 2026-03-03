import { realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ResolvedPackageSource } from "./types";

function parseNpmSource(source: string): ResolvedPackageSource {
	const spec = source.slice(4).trim();
	if (spec.length === 0) {
		throw new Error(`invalid npm source: ${source}`);
	}
	const at = spec.lastIndexOf("@");
	if (at <= 0) {
		return {
			kind: "npm",
			source,
			identity: spec,
			packageName: spec,
			version: null,
			pinned: false,
		};
	}
	const packageName = spec.slice(0, at);
	const version = spec.slice(at + 1);
	if (version.length === 0) {
		return {
			kind: "npm",
			source,
			identity: spec,
			packageName: spec,
			version: null,
			pinned: false,
		};
	}
	return {
		kind: "npm",
		source,
		identity: packageName,
		packageName,
		version,
		pinned: true,
	};
}

function stripGitRef(spec: string): { url: string; ref: string | null } {
	const hashIndex = spec.indexOf("#");
	if (hashIndex >= 0) {
		const url = spec.slice(0, hashIndex);
		const ref = spec.slice(hashIndex + 1);
		return {
			url,
			ref: ref.length > 0 ? ref : null,
		};
	}
	const atIndex = spec.lastIndexOf("@");
	if (atIndex > 0) {
		const url = spec.slice(0, atIndex);
		const ref = spec.slice(atIndex + 1);
		if (!url.includes("/")) {
			return { url: spec, ref: null };
		}
		return {
			url,
			ref: ref.length > 0 ? ref : null,
		};
	}
	return {
		url: spec,
		ref: null,
	};
}

function parseGitSource(source: string): ResolvedPackageSource {
	const stripped = source.startsWith("git:") ? source.slice(4) : source;
	const { url, ref } = stripGitRef(stripped.trim());
	if (url.length === 0) {
		throw new Error(`invalid git source: ${source}`);
	}
	return {
		kind: "git",
		source,
		identity: url,
		url,
		ref,
		pinned: ref !== null,
	};
}

async function resolveLocalPath(
	source: string,
	settingsFile: string,
): Promise<string> {
	const baseDir = dirname(settingsFile);
	const candidate = resolve(baseDir, source);
	const canonical = await realpath(candidate).catch(() => resolve(candidate));
	const canonicalBase = await realpath(baseDir).catch(() => resolve(baseDir));
	const normalizedBase = canonicalBase.endsWith("/")
		? canonicalBase
		: `${canonicalBase}/`;
	if (source.startsWith(".") && !canonical.startsWith(normalizedBase)) {
		throw new Error(
			`local source escaped settings dir jail: ${source} (base ${canonicalBase})`,
		);
	}
	return canonical;
}

export async function resolvePackageSource(input: {
	source: string;
	settingsFile: string;
}): Promise<ResolvedPackageSource> {
	const source = input.source.trim();
	if (source.startsWith("npm:")) {
		return parseNpmSource(source);
	}
	if (
		source.startsWith("git:") ||
		source.startsWith("http://") ||
		source.startsWith("https://") ||
		source.startsWith("github.com/")
	) {
		return parseGitSource(source);
	}
	const canonicalPath = await resolveLocalPath(source, input.settingsFile);
	return {
		kind: "local",
		source,
		identity: canonicalPath,
		path: canonicalPath,
		pinned: false,
	};
}
