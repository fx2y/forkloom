function escapeRegex(value: string): string {
	return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
	let out = "^";
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		if (!char) {
			continue;
		}
		if (char === "*") {
			if (pattern[index + 1] === "*") {
				index += 1;
				if (pattern[index + 1] === "/") {
					out += "(?:.*/)?";
					index += 1;
				} else {
					out += ".*";
				}
			} else {
				out += "[^/]*";
			}
			continue;
		}
		out += escapeRegex(char);
	}
	out += "$";
	return new RegExp(out);
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function applyFilterRules(allPaths: string[], rules?: string[]): string[] {
	const all = [...allPaths].map(normalizePath);
	if (rules === undefined) {
		return all;
	}
	if (rules.length === 0) {
		return [];
	}

	const includes = rules.filter(
		(rule) => !rule.startsWith("!") && !rule.startsWith("+") && !rule.startsWith("-"),
	);
	const excludes = rules
		.filter((rule) => rule.startsWith("!"))
		.map((rule) => rule.slice(1))
		.filter((rule) => rule.length > 0);
	const forceInclude = rules
		.filter((rule) => rule.startsWith("+"))
		.map((rule) => rule.slice(1))
		.filter((rule) => rule.length > 0)
		.map(normalizePath);
	const forceExclude = rules
		.filter((rule) => rule.startsWith("-"))
		.map((rule) => rule.slice(1))
		.filter((rule) => rule.length > 0)
		.map(normalizePath);

	let selected = includes.length === 0
		? all
		: all.filter((path) => includes.some((rule) => globToRegex(rule).test(path)));

	if (excludes.length > 0) {
		selected = selected.filter(
			(path) => !excludes.some((rule) => globToRegex(rule).test(path)),
		);
	}
	if (forceExclude.length > 0) {
		const forceExcludeSet = new Set(forceExclude);
		selected = selected.filter((path) => !forceExcludeSet.has(path));
	}
	if (forceInclude.length > 0) {
		const selectedSet = new Set(selected);
		const knownSet = new Set(all);
		for (const path of forceInclude) {
			if (!knownSet.has(path)) {
				continue;
			}
			selectedSet.add(path);
		}
		selected = [...selectedSet];
	}

	selected.sort((left, right) => left.localeCompare(right));
	return selected;
}
