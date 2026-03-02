export function parseSkillArgs(argsText: string): string[] {
	const input = argsText.trim();
	if (input.length === 0) {
		return [];
	}
	const args: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;
	let tokenOpen = false;

	for (const char of input) {
		if (escaped) {
			current += char;
			escaped = false;
			tokenOpen = true;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			tokenOpen = true;
			continue;
		}
		if (quote != null) {
			if (char === quote) {
				quote = null;
				tokenOpen = true;
				continue;
			}
			current += char;
			tokenOpen = true;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			tokenOpen = true;
			continue;
		}
		if (/\s/u.test(char)) {
			if (tokenOpen) {
				args.push(current);
				current = "";
				tokenOpen = false;
			}
			continue;
		}
		current += char;
		tokenOpen = true;
	}

	if (escaped) {
		throw new Error("invalid skill args: trailing escape");
	}
	if (quote != null) {
		throw new Error("invalid skill args: unmatched quote");
	}
	if (tokenOpen) {
		args.push(current);
	}
	return args;
}
