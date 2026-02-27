import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@forkloom/contracts": resolve(__dirname, "packages/contracts/src/index"),
      "@forkloom/shared": resolve(__dirname, "packages/shared/src/index"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
