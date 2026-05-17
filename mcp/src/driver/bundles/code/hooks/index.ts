/**
 * Q27: pre-review infrastructure hooks. The four files documented by Global
 * Rules #10 / #15 / #16 / #19 are emitted at `before-step` on the `review`
 * step so the reviewer fan-out (Q9) sees them:
 *
 *   - .claude/diff.txt                     (Global Rule #10 file-pointer mode)
 *   - .claude/past-misses-<agent>.md       (Global Rule #15, per reviewer)
 *   - .claude/antipattern-candidates.md    (Global Rule #16)
 *   - .claude/caller-context.md            (Global Rule #19, MEDIUM/COMPLEX)
 *
 * Hooks must not throw — `runHooks()` in `driver/core/invoke-hooks.ts`
 * already swallows + logs failures and continues — but each hook here is
 * additionally written to degrade gracefully when its source is empty
 * (no past-miss feedback yet, CLAUDE.md without formalizable rules, no
 * signature changes in the diff, git unavailable, etc.).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { HookPlugin, DriverState } from "../../../types/plugin.js";
import { claudeDir } from "../../../../lib/paths.js";
import { pipelineGetPastMisses } from "../../../../tools/get-past-misses.js";

const exec = promisify(execFile);

const REVIEWER_AGENTS = [
  "logic-reviewer",
  "challenger-reviewer",
  "style-reviewer",
  "security",
  "performance",
] as const;

async function ensureClaudeDir(state: DriverState): Promise<string> {
  const dir = claudeDir(state.project_dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function readDiffText(state: DriverState): Promise<string> {
  const path = join(claudeDir(state.project_dir), "diff.txt");
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Q27 — Global Rule #10: emit the full working-tree diff so reviewer agents
 * can scope their review to the change set. Best-effort: git unavailable or
 * non-repo writes an explanatory stub instead of failing.
 */
const GIT_DIFF_SNAPSHOT: HookPlugin = {
  name: "git-diff-snapshot",
  event: "before-step",
  step_filter: "review",
  async run(state) {
    const dir = await ensureClaudeDir(state);
    const out = join(dir, "diff.txt");
    try {
      const { stdout } = await exec("git", ["diff"], {
        cwd: state.project_dir,
        maxBuffer: 16 * 1024 * 1024,
      });
      await writeFile(out, stdout, "utf8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await writeFile(
        out,
        `(git diff failed: ${msg})\n`,
        "utf8",
      );
    }
  },
};

/**
 * Q27 — Global Rule #15: cache the top human-confirmed past misses per
 * reviewer agent in a per-agent file so reviewers can read it as context.
 * Falls back to a "(no past-miss data)" stub when feedback is empty.
 */
const LOAD_PAST_MISSES: HookPlugin = {
  name: "load-past-misses",
  event: "before-step",
  step_filter: "review",
  async run(state) {
    const dir = await ensureClaudeDir(state);
    state.scratch.past_misses_loaded_for_review = true;
    for (const agent of REVIEWER_AGENTS) {
      const out = join(dir, `past-misses-${agent}.md`);
      try {
        const res = await pipelineGetPastMisses({
          agent,
          top_n: 10,
          human_confirmed_only: true,
        });
        const entries = res?.entries ?? [];
        if (entries.length === 0) {
          await writeFile(out, `# past misses — ${agent}\n\n(no past-miss data)\n`, "utf8");
          continue;
        }
        const lines: string[] = [`# past misses — ${agent}`, ""];
        for (const e of entries) {
          const cat = e.category ?? "uncategorized";
          const summary = (e.summary ?? "(no summary)").toString().replace(/\s+/g, " ").trim();
          lines.push(`- [${cat}] ${summary} (score=${e._score ?? "?"})`);
        }
        lines.push("");
        await writeFile(out, lines.join("\n"), "utf8");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await writeFile(
          out,
          `# past misses — ${agent}\n\n(failed to load: ${msg})\n`,
          "utf8",
        );
      }
    }
  },
};

const NOT_TO_DO_HEADER = /^#{1,4}\s+(what\s+not\s+to\s+do|don'?t|anti[\s-]*patterns)/i;
const SECTION_HEADER = /^#{1,4}\s+/;

function extractAntiPatternRules(claudeMd: string): string[] {
  const lines = claudeMd.split("\n");
  const rules: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (NOT_TO_DO_HEADER.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && SECTION_HEADER.test(line)) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    const m = line.match(/^\s*[-*]\s+(.*\S)\s*$/);
    if (m) rules.push(m[1]);
  }
  return rules;
}

/**
 * Q27 — Global Rule #16: scan CLAUDE.md "What NOT to do" section and
 * surface candidates that the implementation diff appears to violate. Pure
 * substring-overlap heuristic — produces signal, not certainty. Surface
 * stub if CLAUDE.md is absent or has no formalizable rules.
 */
const ANTI_PATTERN_GREP: HookPlugin = {
  name: "anti-pattern-grep",
  event: "before-step",
  step_filter: "review",
  async run(state) {
    const dir = await ensureClaudeDir(state);
    const out = join(dir, "antipattern-candidates.md");
    state.scratch.antipattern_grep_done = true;
    let claudeMd = "";
    try {
      claudeMd = await readFile(join(state.project_dir, "CLAUDE.md"), "utf8");
    } catch {
      await writeFile(out, "(no CLAUDE.md found)\n", "utf8");
      return;
    }
    const rules = extractAntiPatternRules(claudeMd);
    if (rules.length === 0) {
      await writeFile(out, "(no formalizable rules)\n", "utf8");
      return;
    }
    const diff = await readDiffText(state);
    if (!diff) {
      await writeFile(out, "(no diff content available to compare against)\n", "utf8");
      return;
    }
    const diffLower = diff.toLowerCase();
    const lines: string[] = ["# antipattern candidates", ""];
    let hits = 0;
    for (const rule of rules) {
      // Hit when ≥2 alphanumeric tokens of the rule (length ≥ 4) appear in
      // the diff. Cheap, language-agnostic, surfaces the obvious matches
      // without false-positives on every common word.
      const tokens = rule
        .toLowerCase()
        .match(/[a-z0-9_]{4,}/g) ?? [];
      const present = tokens.filter((t) => diffLower.includes(t));
      if (present.length >= 2) {
        hits++;
        lines.push(`- ${rule}`);
        lines.push(`  matched tokens: ${present.slice(0, 5).join(", ")}`);
      }
    }
    if (hits === 0) lines.push("(no candidates surfaced from CLAUDE.md rules)");
    lines.push("");
    await writeFile(out, lines.join("\n"), "utf8");
  },
};

const FN_DEF_REGEXES: RegExp[] = [
  /^\+\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/,
  /^\+\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s+)?\(/,
  /^\+\s*(?:export\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/,
  /^\+\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
];

function extractFunctionNamesFromDiff(diff: string): string[] {
  const names = new Set<string>();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+")) continue;
    for (const re of FN_DEF_REGEXES) {
      const m = line.match(re);
      if (m) names.add(m[1]);
    }
  }
  return Array.from(names);
}

const MAX_CALLER_SITES = 30;
const CONTEXT_LINES_BEFORE = 2;
const CONTEXT_LINES_AFTER = 4;

interface CallerSite {
  fn: string;
  file: string;
  line: number;
  excerpt: string;
}

async function findCallerSites(
  projectDir: string,
  fnNames: string[],
): Promise<CallerSite[]> {
  const sites: CallerSite[] = [];
  if (fnNames.length === 0) return sites;
  // Use git grep — fast and respects .gitignore. Fall back silently when
  // git isn't available; the hook reports "(no callers found)".
  for (const fn of fnNames) {
    if (sites.length >= MAX_CALLER_SITES) break;
    let stdout = "";
    try {
      const r = await exec(
        "git",
        ["grep", "-n", "--word-regexp", "--", fn],
        { cwd: projectDir, maxBuffer: 8 * 1024 * 1024 },
      );
      stdout = r.stdout;
    } catch {
      continue;
    }
    const linesByFile = new Map<string, number[]>();
    for (const raw of stdout.split("\n")) {
      if (!raw) continue;
      const m = raw.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) continue;
      const file = m[1];
      const lineNum = Number(m[2]);
      if (!linesByFile.has(file)) linesByFile.set(file, []);
      linesByFile.get(file)!.push(lineNum);
    }
    for (const [file, lineNums] of linesByFile) {
      if (sites.length >= MAX_CALLER_SITES) break;
      const fullPath = join(projectDir, file);
      let content = "";
      try {
        content = await readFile(fullPath, "utf8");
      } catch {
        continue;
      }
      const allLines = content.split("\n");
      for (const ln of lineNums) {
        if (sites.length >= MAX_CALLER_SITES) break;
        const start = Math.max(0, ln - 1 - CONTEXT_LINES_BEFORE);
        const end = Math.min(allLines.length, ln - 1 + CONTEXT_LINES_AFTER + 1);
        const excerpt = allLines
          .slice(start, end)
          .map((l, i) => `  ${start + i + 1}: ${l}`)
          .join("\n");
        sites.push({ fn, file, line: ln, excerpt });
      }
    }
  }
  return sites;
}

/**
 * Q27 — Global Rule #19: for MEDIUM/COMPLEX tasks, find callers of new or
 * modified functions and write 5-10 lines of context per site. Caps at 30
 * sites to keep the file readable. Heuristic — extracts function names
 * from "+ function foo(..." style diff lines; misses fancy patterns. When
 * nothing surfaces, writes "(no callers found)" so downstream readers know
 * the file was attempted.
 */
const CALLER_CONTEXT_EXPAND: HookPlugin = {
  name: "caller-context-expand",
  event: "before-step",
  step_filter: "review",
  async run(state) {
    if (state.decisions["complexity"] === "simple") return;
    const dir = await ensureClaudeDir(state);
    const out = join(dir, "caller-context.md");
    state.scratch.caller_context_done = true;
    const diff = await readDiffText(state);
    const fnNames = extractFunctionNamesFromDiff(diff);
    if (fnNames.length === 0) {
      await writeFile(out, "(no function-signature changes detected)\n", "utf8");
      return;
    }
    let sites: CallerSite[] = [];
    try {
      sites = await findCallerSites(state.project_dir, fnNames);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await writeFile(out, `(caller search failed: ${msg})\n`, "utf8");
      return;
    }
    if (sites.length === 0) {
      await writeFile(out, "(no callers found)\n", "utf8");
      return;
    }
    const lines: string[] = [
      "# caller context",
      "",
      `Found ${sites.length} caller site(s) for ${fnNames.length} new/changed symbol(s).`,
      "",
    ];
    for (const s of sites) {
      lines.push(`## ${s.fn} — ${s.file}:${s.line}`);
      lines.push("```");
      lines.push(s.excerpt);
      lines.push("```");
      lines.push("");
    }
    await writeFile(out, lines.join("\n"), "utf8");
  },
};

export const BUILTIN_HOOKS: HookPlugin[] = [
  GIT_DIFF_SNAPSHOT,
  LOAD_PAST_MISSES,
  ANTI_PATTERN_GREP,
  CALLER_CONTEXT_EXPAND,
];

// Exported for tests so they can stub git invocation without running it.
export const __internals = {
  extractAntiPatternRules,
  extractFunctionNamesFromDiff,
  findCallerSites,
};
