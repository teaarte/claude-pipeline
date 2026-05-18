/**
 * v2.2.6 (C3): table-driven stack detection.
 *
 * Replaces the previous per-language regex pyramid with two pure functions:
 *
 *   gatherStackSignals(projectDir)  — IO: reads project root + CLAUDE.md +
 *     package.json; returns a structural signal struct.
 *   resolveStack(signals, candidates) — pure: walks the candidate registry
 *     (`templates/stack-candidates.yaml`) to pick language, package manager,
 *     project type, and default commands. No per-language branches.
 *
 * Adding a new ecosystem = edit `stack-candidates.yaml`. This file does NOT
 * enumerate any specific language. Behavior parity with the v2.2.5 detector
 * is preserved for the existing test fixtures (Q17/Q26/Q50/Q51); new tests
 * cover C# / Svelte / Elixir / Dart paths that the old detector couldn't
 * see.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  loadStackCandidates,
  type StackCandidates,
  type ProjectType,
  type LanguageCandidate,
  type PackageManagerCandidate,
  type ProjectTypeSignal,
} from "../../../../lib/stack-candidates.js";

export type DetectedStack = {
  language: string;
  package_manager: string | null;
  test_command: string | null;
  lint_command: string | null;
  build_command: string | null;
  project_type: ProjectType | null;
};

export type ClaudeMdCommands = {
  test_command?: string;
  lint_command?: string;
  build_command?: string;
};

export type StackSignals = {
  files_present: string[];
  package_json: Record<string, any> | null;
  claude_md_commands: ClaudeMdCommands | null;
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

async function listRootFiles(projectDir: string): Promise<string[]> {
  try {
    const entries = await readdir(projectDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() || e.isSymbolicLink()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Q26 / parseClaudeMd: parse "Validation Commands" labels from CLAUDE.md.
 * The marker-block form (`<!-- validation-commands -->`) lands in C5; this
 * commit keeps the English-header path identical to v2.2.5.
 */
function parseClaudeMd(content: string): ClaudeMdCommands | null {
  const out: ClaudeMdCommands = {};
  const labels: Array<[string, keyof ClaudeMdCommands]> = [
    ["Test", "test_command"],
    ["Lint", "lint_command"],
    ["Build", "build_command"],
  ];
  for (const raw of content.split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    line = line.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").trim();
    for (const [label, key] of labels) {
      if (out[key]) continue;
      const m = line.match(new RegExp(`^${label}\\s*:\\s*(.+?)\\s*$`, "i"));
      if (m && m[1]) {
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a signal-file pattern against the project's root basenames.
 * Patterns support `*` as a multi-char wildcard ("*.csproj", "tsconfig.*.json",
 * "next.config.*"). Bare names match exactly.
 */
function matchesPattern(pattern: string, basenames: string[]): boolean {
  if (!pattern.includes("*")) return basenames.includes(pattern);
  const parts = pattern.split("*").map(escapeRegex);
  const re = new RegExp(`^${parts.join(".*")}$`);
  return basenames.some((n) => re.test(n));
}

function anyPatternMatches(patterns: string[], basenames: string[]): boolean {
  return patterns.some((p) => matchesPattern(p, basenames));
}

function packageJsonDeps(pkg: Record<string, any> | null): Set<string> {
  if (!pkg) return new Set();
  const merged: Record<string, unknown> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };
  return new Set(Object.keys(merged));
}

function packageJsonScripts(pkg: Record<string, any> | null): Record<string, string> {
  if (!pkg) return {};
  const scripts = pkg.scripts;
  return scripts && typeof scripts === "object" ? scripts : {};
}

/**
 * IO half: read CLAUDE.md, package.json, and the project root file list.
 * Pure function `resolveStack` takes over from here.
 */
export async function gatherStackSignals(projectDir: string): Promise<StackSignals> {
  const [files, claudemd, pkgJsonRaw] = await Promise.all([
    listRootFiles(projectDir),
    readOptional(join(projectDir, "CLAUDE.md")),
    readOptional(join(projectDir, "package.json")),
  ]);
  let pkg: Record<string, any> | null = null;
  if (pkgJsonRaw) {
    try {
      pkg = JSON.parse(pkgJsonRaw);
    } catch {
      pkg = null;
    }
  }
  const claudeCommands = claudemd ? parseClaudeMd(claudemd) : null;
  return {
    files_present: files,
    package_json: pkg,
    claude_md_commands: claudeCommands,
  };
}

function pickLanguage(signals: StackSignals, candidates: StackCandidates): string {
  for (const lang of candidates.languages) {
    if (anyPatternMatches(lang.signal_files, signals.files_present)) {
      return lang.name;
    }
  }
  return "unknown";
}

function pickPackageManager(
  language: string,
  signals: StackSignals,
  candidates: StackCandidates,
): string | null {
  const pmField =
    typeof signals.package_json?.packageManager === "string"
      ? (signals.package_json.packageManager as string)
      : null;
  for (const pm of candidates.package_managers) {
    if (!pm.languages.includes(language)) continue;
    if (anyPatternMatches(pm.signal_files, signals.files_present)) return pm.name;
    if (pmField && pm.package_json_field_prefix && pmField.startsWith(pm.package_json_field_prefix)) {
      return pm.name;
    }
  }
  return null;
}

function projectTypeEntryFires(
  entry: ProjectTypeSignal,
  signals: StackSignals,
  language: string,
): boolean {
  let hasCriterion = false;
  if (entry.signal_files.length > 0) {
    hasCriterion = true;
    if (anyPatternMatches(entry.signal_files, signals.files_present)) return true;
  }
  if (entry.package_json_deps.length > 0) {
    hasCriterion = true;
    const deps = packageJsonDeps(signals.package_json);
    if (entry.package_json_deps.some((d) => deps.has(d))) return true;
  }
  if (entry.languages && entry.languages.length > 0) {
    hasCriterion = true;
    if (entry.languages.includes(language)) return true;
  }
  return hasCriterion ? false : false; // empty entry never fires
}

function pickProjectType(
  signals: StackSignals,
  language: string,
  candidates: StackCandidates,
): ProjectType | null {
  for (const entry of candidates.project_type_signals) {
    if (projectTypeEntryFires(entry, signals, language)) return entry.type;
  }
  return null;
}

function pickCommand(
  cmdName: "test" | "lint" | "build",
  language: string,
  pm: string | null,
  signals: StackSignals,
  candidates: StackCandidates,
): string | null {
  const overrideKey: keyof ClaudeMdCommands = `${cmdName}_command`;
  const override = signals.claude_md_commands?.[overrideKey];
  if (override) return override;
  if (language === "unknown" || pm === null) return null;
  const entry = candidates.default_commands.find(
    (c) => c.language === language && c.package_manager === pm,
  );
  if (!entry) return null;
  const defaultValue = entry[cmdName];
  if (!defaultValue) return null;
  // For Node ecosystems the default command runs `package.json.scripts.<cmd>`;
  // emit only when that script is actually defined. Other ecosystems
  // (rust/python/go/csharp/elixir/dart) have intrinsic default commands and
  // are emitted unconditionally.
  if (language === "typescript" || language === "javascript") {
    const scripts = packageJsonScripts(signals.package_json);
    if (!scripts[cmdName]) return null;
  }
  return defaultValue;
}

/**
 * Pure resolver: takes raw signals + the YAML candidate registry, returns
 * the resolved DetectedStack. No IO, no per-language branches.
 */
export function resolveStack(
  signals: StackSignals,
  candidates: StackCandidates,
): DetectedStack {
  const language = pickLanguage(signals, candidates);
  if (language === "unknown") {
    // No language signal — only CLAUDE.md overrides (if any) survive.
    return {
      ...EMPTY,
      test_command: signals.claude_md_commands?.test_command ?? null,
      lint_command: signals.claude_md_commands?.lint_command ?? null,
      build_command: signals.claude_md_commands?.build_command ?? null,
    };
  }
  const pm = pickPackageManager(language, signals, candidates);
  const project_type = pickProjectType(signals, language, candidates);
  return {
    language,
    package_manager: pm,
    test_command: pickCommand("test", language, pm, signals, candidates),
    lint_command: pickCommand("lint", language, pm, signals, candidates),
    build_command: pickCommand("build", language, pm, signals, candidates),
    project_type,
  };
}

/**
 * Convenience entry point used by `pipelineRunTask`. Loads the candidate
 * registry once per process (cached in `stack-candidates.ts`) + gathers
 * signals + resolves.
 */
export async function detectStack(projectDir: string): Promise<DetectedStack> {
  const [signals, candidates] = await Promise.all([
    gatherStackSignals(projectDir),
    loadStackCandidates(),
  ]);
  return resolveStack(signals, candidates);
}

// Re-export commonly-used types so callers don't reach into stack-candidates.
export type {
  LanguageCandidate,
  PackageManagerCandidate,
  ProjectType,
  ProjectTypeSignal,
  StackCandidates,
};
