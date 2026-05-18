/**
 * Q17 regression: project stack must be auto-detected and persisted onto
 * pipeline-state, not left as {language: "unknown", ...nulls} after every
 * /task run.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectStack } from "../../../../../src/driver/bundles/code/decisions/stack-detect.js";

async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "cp-q17-"));
  return { dir, cleanup: async () => await rm(dir, { recursive: true, force: true }) };
}

describe("Q17 — detectStack", () => {
  it("Node + pnpm + TypeScript + next.config.js → frontend-app TS pnpm", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: "x",
          scripts: { test: "vitest", lint: "eslint .", build: "next build" },
          devDependencies: { typescript: "^5", next: "^14" },
        }),
        "utf8",
      );
      await writeFile(join(dir, "pnpm-lock.yaml"), "", "utf8");
      await writeFile(join(dir, "tsconfig.json"), "{}", "utf8");
      await writeFile(join(dir, "next.config.js"), "module.exports = {};", "utf8");
      const stack = await detectStack(dir);
      expect(stack.language).toBe("typescript");
      expect(stack.package_manager).toBe("pnpm");
      expect(stack.project_type).toBe("frontend-app");
      expect(stack.test_command).toBe("pnpm test");
      expect(stack.build_command).toBe("pnpm build");
    } finally {
      await cleanup();
    }
  });

  it("pyproject.toml only → python, default test=pytest, project_type=backend", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "pyproject.toml"), `[tool.poetry]\nname = "x"\n`, "utf8");
      const stack = await detectStack(dir);
      expect(stack.language).toBe("python");
      expect(stack.test_command).toBe("pytest");
    } finally {
      await cleanup();
    }
  });

  it("CLAUDE.md 'Validation Commands' wins over package.json scripts", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { test: "jest" } }),
        "utf8",
      );
      await writeFile(
        join(dir, "CLAUDE.md"),
        `# Project\n\n## Validation Commands\n- **Test:** \`pnpm -r test\`\n- **Lint:** \`pnpm lint\`\n`,
        "utf8",
      );
      const stack = await detectStack(dir);
      expect(stack.test_command).toBe("pnpm -r test");
      expect(stack.lint_command).toBe("pnpm lint");
    } finally {
      await cleanup();
    }
  });

  it("empty directory → {language: 'unknown', everything else null}", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const stack = await detectStack(dir);
      expect(stack.language).toBe("unknown");
      expect(stack.package_manager).toBeNull();
      expect(stack.test_command).toBeNull();
      expect(stack.project_type).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("Cargo.toml → rust + cargo defaults", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "Cargo.toml"), `[package]\nname = "x"\n`, "utf8");
      const stack = await detectStack(dir);
      expect(stack.language).toBe("rust");
      expect(stack.test_command).toBe("cargo test");
      expect(stack.lint_command).toBe("cargo clippy");
    } finally {
      await cleanup();
    }
  });

  it("go.mod → go + go test defaults, project_type=backend", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "go.mod"), "module x\n\ngo 1.22\n", "utf8");
      const stack = await detectStack(dir);
      expect(stack.language).toBe("go");
      expect(stack.test_command).toBe("go test ./...");
      expect(stack.project_type).toBe("backend");
    } finally {
      await cleanup();
    }
  });

  it("Node package with @nestjs/core → backend", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          dependencies: { "@nestjs/core": "^10" },
          scripts: { test: "jest" },
        }),
        "utf8",
      );
      const stack = await detectStack(dir);
      expect(stack.project_type).toBe("backend");
    } finally {
      await cleanup();
    }
  });

  it("Q26: CLAUDE.md accepts simpler patterns (no backticks, optional bullet)", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { test: "jest", build: "webpack" } }),
        "utf8",
      );
      await writeFile(
        join(dir, "CLAUDE.md"),
        [
          "## Validation Commands",
          "",
          "Lint: pnpm -r lint",
          "**Test**: pnpm -r test",
          "- Build: pnpm -r build",
          "",
        ].join("\n"),
        "utf8",
      );
      const stack = await detectStack(dir);
      expect(stack.lint_command).toBe("pnpm -r lint");
      expect(stack.test_command).toBe("pnpm -r test");
      expect(stack.build_command).toBe("pnpm -r build");
    } finally {
      await cleanup();
    }
  });

  it("Q26: pnpm-workspace.yaml at the root classifies as monorepo (no next/nest signal)", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ name: "root", devDependencies: { typescript: "^5" } }),
        "utf8",
      );
      await writeFile(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n", "utf8");
      await writeFile(join(dir, "tsconfig.json"), "{}", "utf8");
      const stack = await detectStack(dir);
      expect(stack.project_type).toBe("monorepo");
    } finally {
      await cleanup();
    }
  });

  it("Q26: turbo.json without frontend/backend deps → monorepo", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "package.json"), JSON.stringify({ name: "root" }), "utf8");
      await writeFile(join(dir, "turbo.json"), JSON.stringify({ pipeline: {} }), "utf8");
      const stack = await detectStack(dir);
      expect(stack.project_type).toBe("monorepo");
    } finally {
      await cleanup();
    }
  });

  it("Q26: next.js inside a monorepo root still wins as frontend-app (positive type beats monorepo)", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: "root",
          devDependencies: { typescript: "^5", next: "^14" },
        }),
        "utf8",
      );
      await writeFile(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n", "utf8");
      await writeFile(join(dir, "tsconfig.json"), "{}", "utf8");
      await writeFile(join(dir, "next.config.js"), "module.exports = {};", "utf8");
      const stack = await detectStack(dir);
      expect(stack.project_type).toBe("frontend-app");
    } finally {
      await cleanup();
    }
  });

  it("Q26: empty CLAUDE.md doesn't crash; falls through to package.json", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { test: "vitest" } }),
        "utf8",
      );
      await writeFile(join(dir, "CLAUDE.md"), "", "utf8");
      const stack = await detectStack(dir);
      expect(stack.test_command).toBe("npm run test");
    } finally {
      await cleanup();
    }
  });

  it("synthesised s3-panel-like frontend fixture: pnpm + TS + next → expected stack shape", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      // monorepo-like layout, frontend-app under the root.
      await mkdir(join(dir, "apps", "core"), { recursive: true });
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: "s3-panel-like",
          devDependencies: { typescript: "^5", next: "^14" },
          scripts: { test: "turbo run test", lint: "turbo run lint", build: "turbo run build" },
        }),
        "utf8",
      );
      await writeFile(join(dir, "pnpm-lock.yaml"), "", "utf8");
      await writeFile(join(dir, "tsconfig.json"), "{}", "utf8");
      await writeFile(join(dir, "next.config.js"), "module.exports = {};", "utf8");
      const stack = await detectStack(dir);
      expect(stack.language).toBe("typescript");
      expect(stack.package_manager).toBe("pnpm");
      expect(stack.project_type).toBe("frontend-app");
    } finally {
      await cleanup();
    }
  });

  it("Q50: strips trailing `# comment` from CLAUDE.md validation commands", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x" }), "utf8");
      await writeFile(
        join(dir, "CLAUDE.md"),
        [
          "# Project",
          "",
          "## Validation Commands",
          "- **Test:** `pnpm -r test                      # vitest run`",
          "- **Lint:** pnpm lint  # via eslint",
          "- **Build:** `pnpm build`",
        ].join("\n"),
        "utf8",
      );
      const stack = await detectStack(dir);
      expect(stack.test_command).toBe("pnpm -r test");
      expect(stack.lint_command).toBe("pnpm lint");
      expect(stack.build_command).toBe("pnpm build");
    } finally {
      await cleanup();
    }
  });

  it("Q51: pnpm-workspace.yaml without lockfile still detects pnpm", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x" }), "utf8");
      await writeFile(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n", "utf8");
      const stack = await detectStack(dir);
      expect(stack.package_manager).toBe("pnpm");
    } finally {
      await cleanup();
    }
  });

  it("H3: yarn-lock present → yarn-style commands (yarn test, not npm run test)", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { test: "jest", lint: "eslint .", build: "tsc" } }),
        "utf8",
      );
      await writeFile(join(dir, "yarn.lock"), "", "utf8");
      const stack = await detectStack(dir);
      expect(stack.package_manager).toBe("yarn");
      expect(stack.test_command).toBe("yarn test");
      expect(stack.lint_command).toBe("yarn lint");
      expect(stack.build_command).toBe("yarn build");
    } finally {
      await cleanup();
    }
  });

  it("H3: bun.lockb present → bun run test", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { test: "bun test" } }),
        "utf8",
      );
      await writeFile(join(dir, "bun.lockb"), "", "utf8");
      const stack = await detectStack(dir);
      expect(stack.package_manager).toBe("bun");
      expect(stack.test_command).toBe("bun run test");
    } finally {
      await cleanup();
    }
  });

  it("H4: Python pyproject + CLAUDE.md Test override still classifies as backend", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "pyproject.toml"), `[tool.poetry]\nname = "x"\n`, "utf8");
      await writeFile(
        join(dir, "CLAUDE.md"),
        "## Validation Commands\n- **Test:** `pytest -xvs tests/`\n",
        "utf8",
      );
      const stack = await detectStack(dir);
      expect(stack.language).toBe("python");
      expect(stack.test_command).toBe("pytest -xvs tests/");
      expect(stack.project_type).toBe("backend");
    } finally {
      await cleanup();
    }
  });

  it("Q51: package.json packageManager field is honoured when no lockfile present", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ name: "x", packageManager: "pnpm@9.4.0" }),
        "utf8",
      );
      const stack = await detectStack(dir);
      expect(stack.package_manager).toBe("pnpm");
    } finally {
      await cleanup();
    }
  });
});
