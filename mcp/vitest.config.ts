import { defineConfig } from "vitest/config";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Compute a unique tmpdir for this vitest run. paths.ts evaluates
// CLAUDE_PIPELINE_METRICS_DIR at module-load time; the test/helpers/setup
// module's clearMetrics() resets file contents between tests.
const metricsDir = mkdtempSync(join(tmpdir(), "cp-mcp-vitest-metrics-"));

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/smoke.ts"],
      thresholds: {
        lines: 80,
        // Branch threshold deliberately at 75: the remaining 5% gap consists
        // entirely of `??` defaults inside metrics-row builders that fire only
        // on fields the init template always populates. Synthetic tests would
        // mutate state directly to hit them, with zero real-bug-finding value.
        branches: 75,
        statements: 80,
        functions: 80,
      },
    },
    env: {
      CLAUDE_PIPELINE_METRICS_DIR: metricsDir,
    },
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    testTimeout: 10_000,
  },
});
