/**
 * Q27: pre-review infrastructure hooks emit four documented files
 * (.claude/diff.txt, .claude/past-misses-*.md, .claude/antipattern-candidates.md,
 * .claude/caller-context.md) at `before-step` on the `review` step.
 *
 * Tests run the hook bodies directly with a synthetic DriverState — no FSM,
 * no spawn provider. Real-task validation is left for a post-merge run.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  BUILTIN_HOOKS,
  __internals,
} from "../../../../../src/driver/bundles/code/hooks/index.js";
import { makeInitialDriverState } from "../../../../../src/driver/core/state.js";
import { createRegistry } from "../../../../../src/driver/core/registry.js";
import { loadBuiltinPlugins } from "../../../../../src/driver/loaders/builtins.js";
import { agentFeedbackJsonl } from "../../../../../src/lib/paths.js";
import { clearMetrics } from "../../../../helpers/setup.js";
import type { DriverState, HookContext } from "../../../../../src/driver/types/plugin.js";

const exec = promisify(execFile);

const hooksByName = Object.fromEntries(BUILTIN_HOOKS.map((h) => [h.name, h]));

async function makeProject(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "cp-q27-"));
  await mkdir(join(dir, ".claude"), { recursive: true });
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function makeState(projectDir: string, overrides: Partial<DriverState> = {}): DriverState {
  const state = makeInitialDriverState({
    project_dir: projectDir,
    task: "test",
    flow_name: "medium",
  });
  state.decisions["complexity"] = "medium";
  Object.assign(state, overrides);
  return state;
}

function makeCtx(state: DriverState): HookContext {
  const registry = createRegistry();
  loadBuiltinPlugins(registry);
  return { registry, step: "review" };
}

async function makeGitRepo(dir: string): Promise<void> {
  await exec("git", ["init", "-q"], { cwd: dir });
  await exec("git", ["config", "user.email", "t@test"], { cwd: dir });
  await exec("git", ["config", "user.name", "t"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# baseline\n", "utf8");
  await exec("git", ["add", "."], { cwd: dir });
  await exec("git", ["commit", "-q", "-m", "init"], { cwd: dir });
}

describe("Q27 git-diff-snapshot hook", () => {
  it("writes .claude/diff.txt with the working-tree diff", async () => {
    const proj = await makeProject();
    try {
      await makeGitRepo(proj.dir);
      await writeFile(join(proj.dir, "README.md"), "# baseline\n\n+new line\n", "utf8");
      const state = makeState(proj.dir);
      await hooksByName["git-diff-snapshot"].run(state, makeCtx(state));
      const content = await readFile(join(proj.dir, ".claude", "diff.txt"), "utf8");
      expect(content).toContain("README.md");
      expect(content).toContain("+new line");
    } finally {
      await proj.cleanup();
    }
  });

  it("emits a stub when git is unavailable / non-repo", async () => {
    const proj = await makeProject();
    try {
      // No git repo initialized — git diff will fail.
      const state = makeState(proj.dir);
      await hooksByName["git-diff-snapshot"].run(state, makeCtx(state));
      const content = await readFile(join(proj.dir, ".claude", "diff.txt"), "utf8");
      expect(content).toContain("git diff failed");
    } finally {
      await proj.cleanup();
    }
  });
});

describe("Q27 load-past-misses hook", () => {
  beforeEach(async () => {
    await clearMetrics();
  });
  afterEach(async () => {
    await clearMetrics();
  });

  it('writes "(no past-miss data)" for every reviewer when feedback file is empty', async () => {
    const proj = await makeProject();
    try {
      const state = makeState(proj.dir);
      await hooksByName["load-past-misses"].run(state, makeCtx(state));
      for (const agent of ["logic-reviewer", "challenger-reviewer", "style-reviewer", "security", "performance"]) {
        const content = await readFile(join(proj.dir, ".claude", `past-misses-${agent}.md`), "utf8");
        expect(content).toContain(`past misses — ${agent}`);
        expect(content).toContain("(no past-miss data)");
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("renders real entries when feedback file has matching agent rows", async () => {
    const proj = await makeProject();
    try {
      const todayUtc = new Date().toISOString().slice(0, 10);
      await writeFile(
        agentFeedbackJsonl,
        JSON.stringify({
          schema_version: "1.0",
          id: "fb-2026-05-14-aaaaaa",
          agent: "logic-reviewer",
          date: todayUtc,
          category: "race-condition",
          summary: "missed a TOCTOU on the token check",
          human_confirmed: true,
          manual_confidence: 0.9,
        }) + "\n",
        "utf8",
      );
      const state = makeState(proj.dir);
      await hooksByName["load-past-misses"].run(state, makeCtx(state));
      const content = await readFile(
        join(proj.dir, ".claude", "past-misses-logic-reviewer.md"),
        "utf8",
      );
      expect(content).toContain("missed a TOCTOU");
      expect(content).toContain("race-condition");
    } finally {
      await proj.cleanup();
    }
  });
});

describe("Q27 anti-pattern-grep hook", () => {
  it('emits "(no CLAUDE.md found)" when the file is absent', async () => {
    const proj = await makeProject();
    try {
      const state = makeState(proj.dir);
      await hooksByName["anti-pattern-grep"].run(state, makeCtx(state));
      const content = await readFile(
        join(proj.dir, ".claude", "antipattern-candidates.md"),
        "utf8",
      );
      expect(content).toContain("(no CLAUDE.md found)");
    } finally {
      await proj.cleanup();
    }
  });

  it('emits "(no formalizable rules)" when CLAUDE.md lacks an anti-pattern section', async () => {
    const proj = await makeProject();
    try {
      await writeFile(join(proj.dir, "CLAUDE.md"), "# Project\n\nJust prose, no rules.\n", "utf8");
      const state = makeState(proj.dir);
      await hooksByName["anti-pattern-grep"].run(state, makeCtx(state));
      const content = await readFile(
        join(proj.dir, ".claude", "antipattern-candidates.md"),
        "utf8",
      );
      expect(content).toContain("(no formalizable rules)");
    } finally {
      await proj.cleanup();
    }
  });

  it("surfaces matches when diff overlaps a documented anti-pattern", async () => {
    const proj = await makeProject();
    try {
      const claudeMd = [
        "# Project",
        "",
        "## What NOT to do",
        "- Never call eval on untrusted input",
        "- Avoid storing session tokens in localStorage",
      ].join("\n");
      await writeFile(join(proj.dir, "CLAUDE.md"), claudeMd, "utf8");
      // Stage a diff.txt that hits the second rule.
      await writeFile(
        join(proj.dir, ".claude", "diff.txt"),
        "+ window.localStorage.setItem('session', token);\n",
        "utf8",
      );
      const state = makeState(proj.dir);
      await hooksByName["anti-pattern-grep"].run(state, makeCtx(state));
      const content = await readFile(
        join(proj.dir, ".claude", "antipattern-candidates.md"),
        "utf8",
      );
      expect(content).toContain("antipattern candidates");
      expect(content).toContain("session tokens in localStorage");
    } finally {
      await proj.cleanup();
    }
  });
});

describe("Q27 caller-context-expand hook", () => {
  it('emits "(no function-signature changes detected)" when diff has no new defs', async () => {
    const proj = await makeProject();
    try {
      await writeFile(join(proj.dir, ".claude", "diff.txt"), "+ some prose-only change\n", "utf8");
      const state = makeState(proj.dir);
      await hooksByName["caller-context-expand"].run(state, makeCtx(state));
      const content = await readFile(
        join(proj.dir, ".claude", "caller-context.md"),
        "utf8",
      );
      expect(content).toContain("(no function-signature changes detected)");
    } finally {
      await proj.cleanup();
    }
  });

  it("skips on simple-complexity tasks", async () => {
    const proj = await makeProject();
    try {
      const state = makeState(proj.dir, { decisions: { complexity: "simple" } });
      await hooksByName["caller-context-expand"].run(state, makeCtx(state));
      // No file should be written.
      await expect(
        stat(join(proj.dir, ".claude", "caller-context.md")),
      ).rejects.toThrow();
    } finally {
      await proj.cleanup();
    }
  });

  it("finds caller sites when git grep returns matches for diff-extracted names", async () => {
    const proj = await makeProject();
    try {
      await makeGitRepo(proj.dir);
      // Caller of `newHelper` in a tracked file.
      await writeFile(
        join(proj.dir, "main.ts"),
        [
          "import { newHelper } from './lib';",
          "",
          "export function consumer() {",
          "  return newHelper(42);",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );
      await exec("git", ["add", "."], { cwd: proj.dir });
      await exec("git", ["commit", "-q", "-m", "add caller"], { cwd: proj.dir });
      // Pretend the diff introduces newHelper.
      await writeFile(
        join(proj.dir, ".claude", "diff.txt"),
        "+ export function newHelper(n: number) { return n * 2; }\n",
        "utf8",
      );
      const state = makeState(proj.dir);
      await hooksByName["caller-context-expand"].run(state, makeCtx(state));
      const content = await readFile(
        join(proj.dir, ".claude", "caller-context.md"),
        "utf8",
      );
      expect(content).toContain("newHelper");
      expect(content).toContain("main.ts");
      expect(content).toContain("consumer");
    } finally {
      await proj.cleanup();
    }
  });
});

describe("Q27 internals", () => {
  it("extractAntiPatternRules pulls bullet items from the right section", () => {
    const md = [
      "# Top",
      "## What NOT to do",
      "- rule alpha",
      "- rule beta",
      "## Other section",
      "- ignored item",
    ].join("\n");
    const rules = __internals.extractAntiPatternRules(md);
    expect(rules).toEqual(["rule alpha", "rule beta"]);
  });

  it("extractFunctionNamesFromDiff handles function, arrow, class, and python def", () => {
    const diff = [
      "+ export function alpha(x: number) {",
      "+ const beta = async (y: string) => {",
      "+ export class Gamma {",
      "+ def delta(self):",
      "  unrelated line",
    ].join("\n");
    const names = __internals.extractFunctionNamesFromDiff(diff);
    expect(names).toEqual(expect.arrayContaining(["alpha", "beta", "Gamma", "delta"]));
  });
});
