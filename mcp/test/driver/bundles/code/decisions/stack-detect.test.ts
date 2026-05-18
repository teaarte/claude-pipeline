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

  // v2.2.6 (C3): candidate-driven path enables ecosystems the old detector
  // didn't recognize. Adding any of these to the pipeline = edit YAML, no TS.

  it("C# (csproj) → csharp + dotnet + dotnet test", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "MyApp.csproj"), "<Project></Project>", "utf8");
      const stack = await detectStack(dir);
      expect(stack.language).toBe("csharp");
      expect(stack.package_manager).toBe("dotnet");
      expect(stack.test_command).toBe("dotnet test");
      expect(stack.lint_command).toBe("dotnet format --verify-no-changes");
      expect(stack.build_command).toBe("dotnet build");
      expect(stack.project_type).toBe("backend");
    } finally {
      await cleanup();
    }
  });

  it("C# (.sln only) → csharp + dotnet detected via glob signal *.sln", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "MySolution.sln"), "", "utf8");
      const stack = await detectStack(dir);
      expect(stack.language).toBe("csharp");
      expect(stack.package_manager).toBe("dotnet");
    } finally {
      await cleanup();
    }
  });

  it("Svelte (svelte.config.js) → svelte language, frontend-app (signal-file path)", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: "x",
          dependencies: { "@sveltejs/kit": "^2" },
          scripts: { test: "vitest", lint: "eslint .", build: "vite build" },
        }),
        "utf8",
      );
      await writeFile(join(dir, "pnpm-lock.yaml"), "", "utf8");
      await writeFile(join(dir, "svelte.config.js"), "export default {};", "utf8");
      const stack = await detectStack(dir);
      expect(stack.language).toBe("svelte");
      expect(stack.project_type).toBe("frontend-app");
    } finally {
      await cleanup();
    }
  });

  it("Elixir (mix.exs) → elixir + mix + mix test", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "mix.exs"), `defmodule X.MixProject do\nend\n`, "utf8");
      const stack = await detectStack(dir);
      expect(stack.language).toBe("elixir");
      expect(stack.package_manager).toBe("mix");
      expect(stack.test_command).toBe("mix test");
      expect(stack.lint_command).toBe("mix credo");
      expect(stack.build_command).toBe("mix compile");
      expect(stack.project_type).toBe("backend");
    } finally {
      await cleanup();
    }
  });

  it("Dart (pubspec.yaml) → dart + pub + flutter test + frontend-app", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "pubspec.yaml"), "name: my_app\n", "utf8");
      const stack = await detectStack(dir);
      expect(stack.language).toBe("dart");
      expect(stack.package_manager).toBe("pub");
      expect(stack.test_command).toBe("flutter test");
      expect(stack.lint_command).toBe("dart analyze");
      expect(stack.project_type).toBe("frontend-app");
    } finally {
      await cleanup();
    }
  });

  it("Python with poetry.lock → poetry-prefixed commands (PM-aware behavior)", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "pyproject.toml"), `[tool.poetry]\nname = "x"\n`, "utf8");
      await writeFile(join(dir, "poetry.lock"), "", "utf8");
      const stack = await detectStack(dir);
      expect(stack.language).toBe("python");
      expect(stack.package_manager).toBe("poetry");
      expect(stack.test_command).toBe("poetry run pytest");
      expect(stack.lint_command).toBe("poetry run ruff check");
    } finally {
      await cleanup();
    }
  });

  it("Python with uv.lock → uv-prefixed commands", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "pyproject.toml"), `[project]\nname = "x"\n`, "utf8");
      await writeFile(join(dir, "uv.lock"), "", "utf8");
      const stack = await detectStack(dir);
      expect(stack.package_manager).toBe("uv");
      expect(stack.test_command).toBe("uv run pytest");
    } finally {
      await cleanup();
    }
  });

  // v2.2.6 (C5): `<!-- validation-commands -->` marker convention.
  // Language-agnostic — works for CLAUDE.md authored in any language.

  it("C5: marker block `<!-- validation-commands -->` wins over English header", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { test: "vitest" } }),
        "utf8",
      );
      await writeFile(
        join(dir, "CLAUDE.md"),
        [
          "# Project",
          "",
          "## Validation Commands",
          "- Test: pnpm wrong-test",
          "- Lint: pnpm wrong-lint",
          "",
          "<!-- validation-commands -->",
          "- test: pnpm -r test",
          "- lint: pnpm -r lint",
          "- build: pnpm -r build",
          "<!-- /validation-commands -->",
        ].join("\n"),
        "utf8",
      );
      const stack = await detectStack(dir);
      expect(stack.test_command).toBe("pnpm -r test");
      expect(stack.lint_command).toBe("pnpm -r lint");
      expect(stack.build_command).toBe("pnpm -r build");
    } finally {
      await cleanup();
    }
  });

  it("C5: marker block strips backticks + trailing # comments", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x" }), "utf8");
      await writeFile(
        join(dir, "CLAUDE.md"),
        [
          "<!-- validation-commands -->",
          "- test: `pnpm -r test                # vitest`",
          "- lint: pnpm lint  # via eslint",
          "- build: \"pnpm build\"",
          "<!-- /validation-commands -->",
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

  it("C5: marker block works when CLAUDE.md prose is non-English", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x" }), "utf8");
      await writeFile(
        join(dir, "CLAUDE.md"),
        [
          "# Проект",
          "",
          "## Команды для проверки",
          "Запусти эти команды:",
          "",
          "<!-- validation-commands -->",
          "- test: pnpm -r test",
          "- lint: pnpm lint",
          "<!-- /validation-commands -->",
        ].join("\n"),
        "utf8",
      );
      const stack = await detectStack(dir);
      expect(stack.test_command).toBe("pnpm -r test");
      expect(stack.lint_command).toBe("pnpm lint");
    } finally {
      await cleanup();
    }
  });

  it("C5: missing close marker still parses bullets after the open marker (defensive)", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x" }), "utf8");
      await writeFile(
        join(dir, "CLAUDE.md"),
        [
          "<!-- validation-commands -->",
          "- test: pnpm test",
          "",
          "(forgot closing marker)",
        ].join("\n"),
        "utf8",
      );
      const stack = await detectStack(dir);
      expect(stack.test_command).toBe("pnpm test");
    } finally {
      await cleanup();
    }
  });

  it("C5: project WITHOUT CLAUDE.md still gets a sensible stack via candidates", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(join(dir, "Cargo.toml"), `[package]\nname = "x"\n`, "utf8");
      const stack = await detectStack(dir);
      expect(stack.language).toBe("rust");
      expect(stack.test_command).toBe("cargo test");
    } finally {
      await cleanup();
    }
  });
});

/**
 * Extensibility test: prove the YAML-only path works end-to-end by
 * injecting a synthetic Crystal language candidate via the resolveStack
 * pure function. If the resolver picks the new language without any TS
 * edit, the architecture goal of v2.2.6 is met.
 */
describe("C3: resolveStack accepts in-test YAML extensions (Crystal)", () => {
  it("a fixture project with shard.yml resolves to the synthetic 'crystal' language", async () => {
    const { resolveStack } = await import("../../../../../src/driver/bundles/code/decisions/stack-detect.js");
    const { parseStackCandidatesString } = await import("../../../../../src/lib/stack-candidates.js");
    const candidates = parseStackCandidatesString(`
languages:
  - name: crystal
    signal_files: ["shard.yml"]
    extensions: [".cr"]
package_managers:
  - name: shards
    languages: [crystal]
    signal_files: ["shard.lock"]
default_commands:
  - language: crystal
    package_manager: shards
    test: "crystal spec"
    lint: "ameba"
    build: "shards build"
project_type_signals:
  - type: library
    languages: [crystal]
`);
    const signals = {
      files_present: ["shard.yml", "shard.lock"],
      package_json: null,
      claude_md_commands: null,
    };
    const stack = resolveStack(signals, candidates);
    expect(stack.language).toBe("crystal");
    expect(stack.package_manager).toBe("shards");
    expect(stack.test_command).toBe("crystal spec");
    expect(stack.project_type).toBe("library");
  });
});
