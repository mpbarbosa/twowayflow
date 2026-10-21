import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "dsl", include: ["test/**/*.test.ts"] },
});
