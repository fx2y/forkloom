import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SKILL_FRONTMATTER_PARSER_POLICY } from "../../apps/api/src/skill/frontmatter";

describe("skill parser policy", () => {
	it("pins bounded splitter policy with no direct YAML parser dependencies", () => {
		const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};

		expect(SKILL_FRONTMATTER_PARSER_POLICY.strategy).toBe("bounded-splitter");
		expect(SKILL_FRONTMATTER_PARSER_POLICY.directDependencies).toEqual([]);

		const deps = {
			...(pkg.dependencies ?? {}),
			...(pkg.devDependencies ?? {}),
		};
		for (const dep of SKILL_FRONTMATTER_PARSER_POLICY.forbiddenTransitiveParsers) {
			expect(deps[dep]).toBeUndefined();
		}
	});

	it("keeps parser source free from direct yaml/gray-matter imports", () => {
		const source = readFileSync(
			resolve("apps/api/src/skill/frontmatter.ts"),
			"utf8",
		);
		expect(source).not.toMatch(/from ["']yaml["']/);
		expect(source).not.toMatch(/from ["']gray-matter["']/);
		expect(source).not.toMatch(/from ["']js-yaml["']/);
		expect(source).not.toMatch(/from ["']front-matter["']/);
	});
});
