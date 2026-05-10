import { defineConfig } from "vitest/config";

// Plain vitest. The parser is pure TypeScript with no Workers-runtime
// dependencies, so we don't need @cloudflare/vitest-pool-workers here.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
