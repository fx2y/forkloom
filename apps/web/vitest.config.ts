import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@forkloom/contracts": resolve(
				__dirname,
				"../../packages/contracts/src/index",
			),
			"@forkloom/shared": resolve(__dirname, "../../packages/shared/src/index"),
		},
	},
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.ts", "test/**/*.test.ts"],
	},
});
