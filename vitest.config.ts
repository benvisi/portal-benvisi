import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Separate from vite.config.ts (which is wrapped by
// @lovable.dev/vite-tanstack-config and not meant to carry a `test` key).
// Only tsconfigPaths is needed here so `@/` imports resolve the same way in
// tests as they do in the app.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
