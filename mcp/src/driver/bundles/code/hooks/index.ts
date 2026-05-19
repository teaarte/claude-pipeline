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
import { extractJsonHeader } from "../../../../lib/parse-json-header.js";
import { validate } from "../../../../lib/schemas.js";
import { audit } from "../../../../lib/audit.js";

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

const MARKER_OPEN = /<!--\s*antipattern\s*-->/i;
const MARKER_CLOSE = /<!--\s*\/antipattern\s*-->/i;
const NOT_TO_DO_HEADER = /^#{1,4}\s+(what\s+not\s+to\s+do|don'?t|anti[\s-]*patterns)/i;
const SECTION_HEADER = /^#{1,4}\s+/;

/**
 * Extract anti-pattern rules from CLAUDE.md. Preferred convention (Q59):
 * an explicit `<!-- antipattern -->` / `<!-- /antipattern -->` marker block.
 * Falls back to the legacy English-keyword "What NOT to do" header for
 * unconverted projects.
 */
function extractAntiPatternRules(claudeMd: string): string[] {
  const lines = claudeMd.split("\n");
  if (MARKER_OPEN.test(claudeMd)) {
    return extractByMarker(lines);
  }
  return extractByHeader(lines);
}

function extractByMarker(lines: string[]): string[] {
  const rules: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (MARKER_OPEN.test(line)) {
      inBlock = true;
      continue;
    }
    if (MARKER_CLOSE.test(line)) {
      inBlock = false;
      continue;
    }
    if (!inBlock) continue;
    const m = line.match(/^\s*[-*]\s+(.*\S)\s*$/);
    if (m) rules.push(m[1]);
  }
  return rules;
}

function extractByHeader(lines: string[]): string[] {
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
 * Item 9 (closes Q44): write applicable anti-pattern rules to
 * `antipattern-candidates.md` based on `state.decisions.antipattern_rules_applicable`
 * (populated by the classifier-agent in the context phase). When the
 * classifier didn't run or returned no rules, emit a clean stub — never
 * fall back to keyword overlap (the old false-positive source).
 *
 * The classifier-agent decides applicability in any language. Rule
 * extraction from CLAUDE.md still happens here so we can surface the
 * FULL rule text alongside its identifier.
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
    const applicable = state.decisions["antipattern_rules_applicable"];
    const applicableSet = new Set(
      Array.isArray(applicable)
        ? applicable.filter((r): r is string => typeof r === "string")
        : [],
    );
    const lines: string[] = ["# antipattern candidates", ""];
    let hits = 0;
    for (const rule of rules) {
      // Match by rule text OR by index. The classifier may have emitted
      // rule strings directly OR a stable identifier ("rule-3"); we
      // accept either form to keep the classifier prompt flexible.
      const idx = rules.indexOf(rule);
      const identifier = `rule-${idx}`;
      if (applicableSet.has(rule) || applicableSet.has(identifier)) {
        hits++;
        lines.push(`- ${rule}`);
      }
    }
    if (hits === 0) {
      lines.push("(no applicable rules — classifier-agent reported none)");
    }
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

/**
 * D1 / Q-classifier-auto-spawn: parse the classifier-agent's JSON output
 * delivered via pipeline_continue_task and populate state.decisions with
 * its LLM-derived classification. Pure getter decisions (refs-to-load,
 * security-needed, antipattern-rules-applicable) consume these slots;
 * without an upstream populating them they returned safe defaults and the
 * refs catalog stayed dead. CLASSIFY_AGENT spawns; this hook parses.
 *
 * The parse-on-resume logic lives here (not inside CLASSIFY_AGENT.run)
 * because continue-task auto-advances state.step_index after delivering
 * the agent_output — the step's resume short-circuit would never fire.
 *
 * Failure mode: unparseable JSON OR schema-invalid output → keep existing
 * defaults, audit `error_class: "llm-classification-needed"`, return. The
 * FSM never blocks on a classifier hiccup.
 */
const EXTRACT_CLASSIFIER_OUTPUT: HookPlugin = {
  name: "extract-classifier-output",
  event: "after-agent-result",
  async run(state, ctx) {
    if (ctx.agent !== "classifier") return;
    const output = ctx.agent_output ?? "";
    if (output.length === 0) return;
    const parsed = extractJsonHeader(output);
    if (!parsed.ok) {
      await audit({
        tool: "pipeline_classify_agent",
        args: { task_id: state.task_id, reason: parsed.reason },
        projectDir: state.project_dir,
        verdict: "ok",
        error_class: "llm-classification-needed",
      }).catch(() => undefined);
      return;
    }
    const valid = await validate("classifier-output.schema.json", parsed.value);
    if (!valid.ok) {
      await audit({
        tool: "pipeline_classify_agent",
        args: {
          task_id: state.task_id,
          schema_errors: valid.errors
            .slice(0, 3)
            .map((e) => `${e.path}: ${e.message}`)
            .join("; "),
        },
        projectDir: state.project_dir,
        verdict: "ok",
        error_class: "llm-classification-needed",
      }).catch(() => undefined);
      return;
    }
    const v = parsed.value as Record<string, unknown>;
    if (typeof v.task_short === "string" && v.task_short.trim().length > 0) {
      state.decisions["task_short"] = v.task_short.trim();
    }
    if (Array.isArray(v.refs_to_load)) {
      state.decisions["refs_to_load"] = (v.refs_to_load as unknown[]).filter(
        (r): r is string => typeof r === "string",
      );
    }
    if (typeof v.security_needed === "boolean") {
      state.decisions["security_needed"] = v.security_needed;
    }
    if (Array.isArray(v.antipattern_rules_applicable)) {
      state.decisions["antipattern_rules_applicable"] = (v.antipattern_rules_applicable as unknown[]).filter(
        (r): r is string => typeof r === "string",
      );
    }
    if (v.stack && typeof v.stack === "object") {
      state.decisions["stack"] = v.stack;
    }
    if (typeof v.change_kind === "string" || v.change_kind === null) {
      state.decisions["change_kind"] = v.change_kind;
    }
  },
};

// Q-tech-debt / D3: signal phrases that mark a paragraph as a tech-debt /
// out-of-scope observation in implementer prose. Real-task frontend-core
// 2026-05-18 case: "Pre-existing prettier debt in repo (19 files): mostly
// .md files plus a few pre-existing TS files; not a regression." Multiple
// matches per paragraph are fine — the paragraph is captured once.
const TECH_DEBT_SIGNAL_PHRASES: RegExp[] = [
  /\bpre[-\s]?existing\b/i,
  /\bout[-\s]?of[-\s]?scope\b/i,
  /\bnot a regression\b/i,
  /\bnoticed\b/i,
  /\balso worth fixing\b/i,
  /\bTODO:/i,
  /\bFIXME:/i,
];

function paragraphHash(p: string): string {
  // djb2-style 32-bit hash, hex. Stable across runs so re-firing the hook
  // on the same paragraph is idempotent. The hash is embedded in the
  // auto-captured marker so we can dedupe on subsequent passes without
  // tokenising the markdown.
  let h = 5381;
  const norm = p.replace(/\s+/g, " ").trim();
  for (let i = 0; i < norm.length; i++) {
    h = ((h * 33) ^ norm.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Q-tech-debt / D3: scan implementer prose for tech-debt / out-of-scope
 * observations that should have been written to `.claude/issues-found.md`
 * but weren't. Each matching paragraph is appended under an
 * `<!-- auto-captured hash=... -->` marker so the next invocation can
 * dedupe by hash. Implementer-only; other agents emit structured output
 * via the reviewer/validator schema path and don't need this safety net.
 */
const EXTRACT_TECH_DEBT_FROM_PROSE: HookPlugin = {
  name: "extract-tech-debt-from-prose",
  event: "after-agent-result",
  async run(state, ctx) {
    if (ctx.agent !== "implementer") return;
    const output = ctx.agent_output ?? "";
    if (output.length === 0) return;
    const paragraphs = output
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const matches = paragraphs.filter((p) =>
      TECH_DEBT_SIGNAL_PHRASES.some((re) => re.test(p)),
    );
    if (matches.length === 0) return;
    const dir = await ensureClaudeDir(state);
    const out = join(dir, "issues-found.md");
    let existing = "";
    try {
      existing = await readFile(out, "utf8");
    } catch {
      existing = "";
    }
    const existingHashes = new Set<string>();
    const hashRe = /<!--\s*auto-captured\s+hash=([0-9a-f]+)\s*-->/gi;
    let m: RegExpExecArray | null;
    while ((m = hashRe.exec(existing)) !== null) {
      existingHashes.add(m[1]);
    }
    const newBlocks: string[] = [];
    for (const p of matches) {
      const h = paragraphHash(p);
      if (existingHashes.has(h)) continue;
      existingHashes.add(h);
      // Multi-line paragraphs indent continuation lines so the markdown
      // bullet stays attached. The marker comment sits on its own line
      // above the bullet for easy grep / dedupe.
      const indented = p.replace(/\n/g, "\n  ");
      newBlocks.push(`<!-- auto-captured hash=${h} -->\n- ${indented}`);
    }
    if (newBlocks.length === 0) return;
    const header = existing.length === 0 ? "# issues-found.md\n\n" : "";
    const sep = existing.length > 0 && !existing.endsWith("\n\n")
      ? (existing.endsWith("\n") ? "\n" : "\n\n")
      : "";
    const next = header + existing + sep + newBlocks.join("\n\n") + "\n";
    await writeFile(out, next, "utf8");
  },
};

// INVARIANT (Q60): GIT_DIFF_SNAPSHOT must run first. ANTI_PATTERN_GREP and
// CALLER_CONTEXT_EXPAND read `.claude/diff.txt` that GIT_DIFF_SNAPSHOT writes.
// Reordering this array silently breaks downstream consumers (empty diff →
// "no candidates" stub instead of real matches). If you need to add a hook
// that reads diff.txt, place it AFTER GIT_DIFF_SNAPSHOT. If you need to add
// a hook that writes a different shared file, document the dependency in the
// invariant block above its addition.
export const BUILTIN_HOOKS: HookPlugin[] = [
  GIT_DIFF_SNAPSHOT,    // ← MUST be first
  LOAD_PAST_MISSES,
  ANTI_PATTERN_GREP,    // reads diff.txt
  CALLER_CONTEXT_EXPAND, // reads diff.txt
  EXTRACT_CLASSIFIER_OUTPUT, // after-agent-result, classifier-only
  EXTRACT_TECH_DEBT_FROM_PROSE, // after-agent-result, implementer-only
];

// Exported for tests so they can stub git invocation without running it.
export const __internals = {
  extractAntiPatternRules,
  extractFunctionNamesFromDiff,
  findCallerSites,
  paragraphHash,
  TECH_DEBT_SIGNAL_PHRASES,
  EXTRACT_TECH_DEBT_FROM_PROSE,
};
