/**
 * Q17: stack detection for pipeline-state.json:stack. Inspects the project
 * root for the usual signals — CLAUDE.md "Validation Commands" section,
 * package.json, pyproject.toml, pubspec.yaml, Cargo.toml, go.mod — and
 * returns a populated Stack. Falls back to `{language: "unknown", ...}`
 * when no signal is found so the schema's `required: ["language"]` still
 * passes.
 *
 * Deliberately small: ~150 lines, regex-only, no glob library. Edge cases
 * we accept losing (monorepos with mixed stacks, partial package.json,
 * exotic Python tooling) are tracked separately as Q17b candidates if
 * real-task validation surfaces them.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type DetectedStack = {
  language: string;
  package_manager: string | null;
  test_command: string | null;
  lint_command: string | null;
  build_command: string | null;
  project_type: "frontend-app" | "backend" | "library" | "monorepo" | null;
};

const EMPTY: DetectedStack = {
  language: "unknown",
  package_manager: null,
  test_command: null,
  lint_command: null,
  build_command: null,
  project_type: null,
};

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  return (await readOptional(path)) !== null;
}

/**
 * Q26: parse "Validation Commands" labels from CLAUDE.md. Accepts every
 * combination of bullet / bold / backticks / quote-wrap we've seen in real
 * project docs:
 *
 *   - **Lint:** `pnpm lint`
 *   - **Lint**: pnpm lint
 *   Lint: pnpm -r test
 *   * Test: "pnpm vitest"
 *
 * Case-insensitive. Returns null when no label matched (caller falls
 * through to package.json / language defaults).
 */
function parseClaudeMd(content: string): Partial<DetectedStack> | null {
  const out: Partial<DetectedStack> = {};
  const labels: Array<[string, "test_command" | "lint_command" | "build_command"]> = [
    ["Test", "test_command"],
    ["Lint", "lint_command"],
    ["Build", "build_command"],
  ];
  for (const raw of content.split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    // Normalise the line so every accepted form collapses to `Label: value`:
    //   strip leading list marker
    //   strip bold markers (so colon position inside vs outside ** doesn't matter)
    line = line.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").trim();
    for (const [label, key] of labels) {
      if (out[key]) continue;
      const m = line.match(new RegExp(`^${label}\\s*:\\s*(.+?)\\s*$`, "i"));
      if (m && m[1]) {
        // Strip one surrounding pair of backticks or quotes, then strip any
        // trailing `# comment` (Q50: CLAUDE.md authors sometimes append a
        // human-readable annotation after the command).
        const value = m[1]
          .trim()
          .replace(/^[`"'](.*)[`"']$/, "$1")
          .replace(/\s*#.*$/, "")
          .trim();
        if (value) out[key] = value;
        break;
      }
    }
  }
  if (!out.test_command && !out.lint_command && !out.build_command) return null;
  return out;
}

/**
 * Q26: pnpm-workspace.yaml / lerna.json / nx.json / turbo.json at the root
 * mark this as a monorepo. Lifts the classification out of the
 * "library" default that the v2.1 Q17 detector emitted for every pnpm /
 * turbo root.
 */
async function isMonorepoRoot(projectDir: string): Promise<boolean> {
  const markers = ["pnpm-workspace.yaml", "lerna.json", "nx.json", "turbo.json"];
  for (const m of markers) {
    if (await fileExists(join(projectDir, m))) return true;
  }
  return false;
}

function scriptCommand(pm: string, script: string): string {
  // pnpm + yarn forward unknown args to the script directly (`pnpm lint`).
  // npm + bun require `run` for non-lifecycle scripts; we always use `run`
  // so the same form works for test / lint / build uniformly.
  if (pm === "pnpm" || pm === "yarn") return `${pm} ${script}`;
  return `${pm} run ${script}`;
}

function parsePackageJson(content: string, pm: string): Partial<DetectedStack> {
  try {
    const pkg = JSON.parse(content);
    const scripts = pkg.scripts ?? {};
    return {
      test_command: scripts.test ? scriptCommand(pm, "test") : null,
      lint_command: scripts.lint ? scriptCommand(pm, "lint") : null,
      build_command: scripts.build ? scriptCommand(pm, "build") : null,
    };
  } catch {
    return {};
  }
}

async function detectNodePackageManager(projectDir: string): Promise<string> {
  // Q51: multi-signal pnpm detection. Lockfile + workspace marker +
  // package.json `packageManager` field all valid signals — even if the
  // lockfile is absent at pipeline_init time (fresh clone, etc.).
  if (await fileExists(join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(join(projectDir, "pnpm-workspace.yaml"))) return "pnpm";
  if (await fileExists(join(projectDir, "yarn.lock"))) return "yarn";
  if (await fileExists(join(projectDir, "bun.lockb"))) return "bun";
  const pkg = await readOptional(join(projectDir, "package.json"));
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      if (typeof parsed.packageManager === "string") {
        const m = parsed.packageManager.match(/^(pnpm|yarn|bun|npm)\b/);
        if (m) return m[1];
      }
    } catch {
      // fall through to default
    }
  }
  return "npm";
}

async function detectFrontendVsBackend(projectDir: string, pkgJson?: any): Promise<DetectedStack["project_type"]> {
  const frontendSignals = [
    "next.config.js",
    "next.config.ts",
    "next.config.mjs",
    "vite.config.js",
    "vite.config.ts",
    "vite.config.mjs",
    "rsbuild.config.js",
    "rsbuild.config.ts",
    "angular.json",
  ];
  for (const s of frontendSignals) {
    if (await fileExists(join(projectDir, s))) return "frontend-app";
  }
  if (pkgJson) {
    const deps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
    if (deps.next || deps.vite || deps["@angular/core"] || deps["react-dom"]) {
      return "frontend-app";
    }
    if (deps["@nestjs/core"] || deps.fastify || deps.express || deps["@hapi/hapi"]) {
      return "backend";
    }
  }
  return "library";
}

export async function detectStack(projectDir: string): Promise<DetectedStack> {
  // CLAUDE.md wins for command overrides — but it doesn't carry language /
  // package_manager / project_type, so we still inspect the ecosystem files.
  const claudemd = await readOptional(join(projectDir, "CLAUDE.md"));
  const claudeOverrides = claudemd ? parseClaudeMd(claudemd) ?? {} : {};

  // package.json (Node / JS / TS) — most common first.
  const pkgJsonRaw = await readOptional(join(projectDir, "package.json"));
  if (pkgJsonRaw) {
    let pkg: any = null;
    try {
      pkg = JSON.parse(pkgJsonRaw);
    } catch {
      pkg = null;
    }
    const tsConfigPresent = await fileExists(join(projectDir, "tsconfig.json"));
    const language = tsConfigPresent || pkg?.devDependencies?.typescript ? "typescript" : "javascript";
    const packageManager = await detectNodePackageManager(projectDir);
    const fromPkg = parsePackageJson(pkgJsonRaw, packageManager);
    // Q26: monorepo signal wins over the legacy "library" default but
    // not over a positive frontend/backend classification (a Next.js
    // app inside a Turborepo root is still a frontend-app).
    const frontendOrBackend = await detectFrontendVsBackend(projectDir, pkg);
    let project_type: DetectedStack["project_type"];
    if (frontendOrBackend === "frontend-app" || frontendOrBackend === "backend") {
      project_type = frontendOrBackend;
    } else if (await isMonorepoRoot(projectDir)) {
      project_type = "monorepo";
    } else {
      project_type = frontendOrBackend;
    }
    return {
      language,
      package_manager: packageManager,
      test_command: claudeOverrides.test_command ?? fromPkg.test_command ?? null,
      lint_command: claudeOverrides.lint_command ?? fromPkg.lint_command ?? null,
      build_command: claudeOverrides.build_command ?? fromPkg.build_command ?? null,
      project_type,
    };
  }

  // pyproject.toml (Python).
  if (await fileExists(join(projectDir, "pyproject.toml"))) {
    const packageMgr = (await fileExists(join(projectDir, "uv.lock")))
      ? "uv"
      : (await fileExists(join(projectDir, "poetry.lock")))
      ? "poetry"
      : "pip";
    return {
      language: "python",
      package_manager: packageMgr,
      test_command: claudeOverrides.test_command ?? "pytest",
      lint_command: claudeOverrides.lint_command ?? "ruff check",
      build_command: claudeOverrides.build_command ?? null,
      project_type: "backend",
    };
  }

  // pubspec.yaml (Dart / Flutter).
  if (await fileExists(join(projectDir, "pubspec.yaml"))) {
    return {
      language: "dart",
      package_manager: "pub",
      test_command: claudeOverrides.test_command ?? "flutter test",
      lint_command: claudeOverrides.lint_command ?? "dart analyze",
      build_command: claudeOverrides.build_command ?? null,
      project_type: "frontend-app",
    };
  }

  // Cargo.toml (Rust).
  if (await fileExists(join(projectDir, "Cargo.toml"))) {
    return {
      language: "rust",
      package_manager: "cargo",
      test_command: claudeOverrides.test_command ?? "cargo test",
      lint_command: claudeOverrides.lint_command ?? "cargo clippy",
      build_command: claudeOverrides.build_command ?? "cargo build",
      project_type: "library",
    };
  }

  // go.mod (Go).
  if (await fileExists(join(projectDir, "go.mod"))) {
    return {
      language: "go",
      package_manager: "go",
      test_command: claudeOverrides.test_command ?? "go test ./...",
      lint_command: claudeOverrides.lint_command ?? "go vet ./...",
      build_command: claudeOverrides.build_command ?? "go build ./...",
      project_type: "backend",
    };
  }

  // No signal — return empty but with CLAUDE.md overrides if any.
  return {
    ...EMPTY,
    ...claudeOverrides,
  };
}
