import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["workers/lib/__tests__/**/*.test.ts"],
		environment: "node",
	},
});
