import { resolve } from "node:path";
import { defineConfig } from "vite";

const apiOrigin = process.env.VITE_API_ORIGIN ?? "http://127.0.0.1:8080";

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
	server: {
		port: 5173,
		proxy: {
			"/artifacts": apiOrigin,
			"/runs": apiOrigin,
			"/health": apiOrigin,
		},
	},
});
