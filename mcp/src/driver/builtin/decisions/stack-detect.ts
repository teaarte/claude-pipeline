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
  project_type: "frontend-app" | "backend" | "library" | null;
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
 * Parse the "## Validation Commands" (or similar) section in CLAUDE.md.
 * Looks for `**Lint:** \`cmd\``, `**Test:** \`cmd\``, `**Build:** \`cmd\``
 * patterns. Case-insensitive. Returns null when CLAUDE.md is absent or has
 * no recognised commands.
 */
function parseClaudeMd(content: string): Partial<DetectedStack> | null {
  // Look anywhere in the doc — the section heading is conventional but not
  // mandatory. We look for the three lines we care about.
  const grab = (label: string): string | null => {
    const re = new RegExp(`\\*\\*${label}\\s*:?\\*\\*\\s*[\`\"]([^\`\"]+)[\`\"]`, "i");
    const m = content.match(re);
    return m ? m[1].trim() : null;
  };
  const lint = grab("Lint");
  const test = grab("Test");
  const build = grab("Build");
  if (!lint && !test && !build) return null;
  return {
    lint_command: lint,
    test_command: test,
    build_command: build,
  };
}

function parsePackageJson(content: string): Partial<DetectedStack> {
  try {
    const pkg = JSON.parse(content);
    const scripts = pkg.scripts ?? {};
    return {
      test_command: scripts.test ? `npm run test` : null,
      lint_command: scripts.lint ? `npm run lint` : null,
      build_command: scripts.build ? `npm run build` : null,
    };
  } catch {
    return {};
  }
}

async function detectNodePackageManager(projectDir: string): Promise<string> {
  if (await fileExists(join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(join(projectDir, "yarn.lock"))) return "yarn";
  if (await fileExists(join(projectDir, "bun.lockb"))) return "bun";
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
    const fromPkg = parsePackageJson(pkgJsonRaw);
    return {
      language,
      package_manager: await detectNodePackageManager(projectDir),
      test_command: claudeOverrides.test_command ?? fromPkg.test_command ?? null,
      lint_command: claudeOverrides.lint_command ?? fromPkg.lint_command ?? null,
      build_command: claudeOverrides.build_command ?? fromPkg.build_command ?? null,
      project_type: await detectFrontendVsBackend(projectDir, pkg),
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
      project_type: claudeOverrides.test_command ? null : "backend",
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
