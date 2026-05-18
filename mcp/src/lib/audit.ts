import { readFile, writeFile, mkdir, appendFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { homeMetricsDir } from "./paths.js";
import { fileExists, readStateSafe } from "./state-io.js";

export const AUDIT_GLOBAL_CAP = 10_000;
/** Per-project audit cap (Performance I1). FIFO-truncated like global. */
export const AUDIT_PROJECT_CAP = 50_000;

export type AuditVerdict = "ok" | "error" | "force_bypass";

/**
 * Q11: categorical label attached to `verdict=error` (and informational
 * for `retry-recovered` paths). Lets post-hoc analysis tell genuine
 * failures from the documented-and-handled noise.
 */
export type ErrorClass =
  | "swallowed-inv"            // closePriorPhases swallowing INV_002/010/011
  | "retry-recovered"          // JSON-header lenient parse repaired the payload
  | "schema-validation"        // reviewer-output / validator-output / finding schema fail
  | "vocab-rejected"           // category not in vocab for agent
  | "git-unavailable"          // Q33: git CLI absent or project_dir isn't a repo
  | "team-knowledge-missing"   // Item 7: a team_knowledge_refs file failed to read
  | "team-knowledge-truncated" // Item 7: combined team-knowledge content hit the 50KB cap
  | "llm-classification-needed" // Item 9: classifier-agent failed/malformed — defaults applied
  | "task_id-rewrite"          // v2.2.6 C6 / Item 6: agent emitted non-canonical task_id, rewritten to state.task_id
  | "genuine-failure";         // anything we don't recognise — investigate

export type AuditEntry = {
  schema_version: "1.0";
  ts: string;
  tool: string;
  task_id: string | null;
  project_dir: string | null;
  args_summary: Record<string, unknown>;
  verdict: AuditVerdict;
  error?: string;
  error_class?: ErrorClass;
  force_used: boolean;
};

/**
 * Map a thrown-error message to a Q11 ErrorClass. Best-effort regex
 * heuristic over the observed message vocabulary; unrecognised messages
 * fall through to `genuine-failure` so the operator can grep for them.
 */
export function classifyErrorMessage(msg: string): ErrorClass {
  // M5: widen to all INV_NNN codes; the prior list missed
  // INV_001/003-009/SCHEMA_STATE/stale-spawn and silently classified
  // everything else as "genuine-failure".
  if (/INV_\d{3}|SCHEMA_STATE|stale-spawn/i.test(msg)) return "swallowed-inv";
  if (/Finding category .+ is not in vocab/.test(msg)) return "vocab-rejected";
  if (/(reviewer-output|validator-output|finding)\.schema\.json validation/i.test(msg)) return "schema-validation";
  if (/Finding failed schema validation/i.test(msg)) return "schema-validation";
  if (/Failed to parse JSON header|no fenced .* block/i.test(msg)) return "schema-validation";
  return "genuine-failure";
}

export function globalAuditFile(): string {
  return join(homeMetricsDir, "mcp-audit.jsonl");
}

export function projectAuditFile(projectDir: string): string {
  return join(projectDir, ".claude", "mcp-audit.jsonl");
}

/**
 * Build a structural summary of tool args. NEVER includes `agent_output` or
 * any other large string (>200 chars collapsed to a length marker).
 */
export function makeArgsSummary(args: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!args || typeof args !== "object") return out;
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (k === "agent_output") {
      // never log the full agent output — too large, may contain user prompts.
      out[k] = typeof v === "string" ? `<${v.length} chars>` : "<omitted>";
      continue;
    }
    if (typeof v === "string" && v.length > 200) {
      out[k] = `<${v.length} chars>`;
      continue;
    }
    out[k] = v;
  }
  return out;
}

async function ensureDir(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
}

async function appendUncapped(file: string, entry: unknown): Promise<void> {
  await ensureDir(file);
  await appendFile(file, JSON.stringify(entry) + "\n", "utf8");
}

/**
 * Build a global-stream audit entry with sensitive fields collapsed
 * (Security sec007). The per-project stream keeps full project_dir + task
 * — that file is /done-cleared. The global stream lives forever; collapsing
 * lets us still see "what tool was called when" without persisting client
 * names or task strings that could contain secrets.
 */
function redactForGlobal(entry: AuditEntry): AuditEntry {
  const copy: AuditEntry = { ...entry, args_summary: { ...entry.args_summary } };
  if (typeof copy.project_dir === "string") {
    copy.project_dir = `<project-dir ${copy.project_dir.length} chars>`;
  }
  const args = copy.args_summary as Record<string, unknown>;
  for (const k of ["task", "task_short", "reason"]) {
    const v = args[k];
    if (typeof v === "string" && v.length > 0) args[k] = `<${k} ${v.length} chars>`;
  }
  return copy;
}

/**
 * Append to a JSONL file but cap total entries at `cap`. H11: always under
 * lock. The prior fast path skipped locking based on a `stat` size estimate,
 * which let two concurrent audits both observe "under cap" and both append,
 * predictably exceeding the cap. Audit is not latency-critical; the lock cost
 * is negligible compared to the storage-bound guarantee.
 */
async function appendCapped(file: string, entry: unknown, cap: number): Promise<void> {
  await ensureDir(file);
  if (!(await fileExists(file))) {
    await writeFile(file, "", "utf8");
  }
  const release = await lockfile.lock(file, {
    retries: { retries: 5, minTimeout: 25, maxTimeout: 200 },
    stale: 10_000,
  });
  try {
    let existing = "";
    try {
      existing = await readFile(file, "utf8");
    } catch {
      existing = "";
    }
    const lines = existing.split("\n").filter(Boolean);
    lines.push(JSON.stringify(entry));
    if (lines.length > cap) {
      const trimmed = lines.slice(lines.length - cap);
      const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
      await writeFile(tmp, trimmed.join("\n") + "\n", "utf8");
      await rename(tmp, file);
    } else {
      await appendFile(file, JSON.stringify(entry) + "\n", "utf8");
    }
  } finally {
    await release().catch(() => undefined);
  }
}

export type AuditCall = {
  tool: string;
  args: unknown;
  projectDir?: string | null;
  verdict: AuditVerdict;
  error?: string;
  error_class?: ErrorClass;
  force_used?: boolean;
};

export async function audit(call: AuditCall): Promise<void> {
  let task_id: string | null = null;
  const projectDir = call.projectDir ?? null;
  if (projectDir) {
    try {
      const state = await readStateSafe(join(projectDir, ".claude", "pipeline-state.json"));
      task_id = (state?.task_id as string | undefined) ?? null;
    } catch {
      task_id = null;
    }
  }
  const entry: AuditEntry = {
    schema_version: "1.0",
    ts: new Date().toISOString(),
    tool: call.tool,
    task_id,
    project_dir: projectDir,
    args_summary: makeArgsSummary(call.args),
    verdict: call.verdict,
    force_used: call.force_used ?? false,
  };
  if (call.error) entry.error = call.error;
  if (call.error_class) entry.error_class = call.error_class;

  try {
    await appendCapped(globalAuditFile(), redactForGlobal(entry), AUDIT_GLOBAL_CAP);
  } catch (e) {
    // Audit must never mask the real tool result. Surface IO errors on
    // stderr so the gap is visible (Challenger #4); the MCP protocol
    // owns stdout.
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(`[audit] failed to write global stream: ${msg}`);
  }
  if (projectDir) {
    try {
      // Per-project audit retains the unredacted entry (it's /done-cleaned).
      // Cap at AUDIT_PROJECT_CAP to bound growth across many tasks in one
      // project (Performance I1).
      await appendCapped(projectAuditFile(projectDir), entry, AUDIT_PROJECT_CAP);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.error(`[audit] failed to write project stream: ${msg}`);
    }
  }
}

/**
 * Extract project_dir from common tool arg shapes. Returns null when the tool
 * has no project_dir (e.g. log-agent-feedback, get-past-misses).
 */
export function pickProjectDir(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const v = (args as Record<string, unknown>).project_dir;
  return typeof v === "string" ? v : null;
}

/**
 * Detect whether the call requested an MCP guard bypass. Two surfaces:
 *  - args.force === true (set-phase-status, /done force-close, future tools)
 *  - explicit "unlock_writes" tool name (added in Item 4)
 */
export function pickForceFlag(toolName: string, args: unknown): boolean {
  if (toolName === "pipeline_unlock_writes") return true;
  if (!args || typeof args !== "object") return false;
  return Boolean((args as Record<string, unknown>).force);
}

/**
 * Wrap a tool impl with audit logging. Each invocation produces exactly one
 * audit entry (ok / force_bypass / error). Errors from the impl propagate;
 * errors from the audit layer itself are swallowed so audit can never mask
 * the real failure.
 */
export function withAudit<I, O>(
  toolName: string,
  impl: (args: I) => Promise<O>,
): (args: I) => Promise<O> {
  return async (args: I) => {
    const projectDir = pickProjectDir(args);
    const forceUsed = pickForceFlag(toolName, args);
    try {
      const result = await impl(args);
      try {
        await audit({
          tool: toolName,
          args,
          projectDir,
          verdict: forceUsed ? "force_bypass" : "ok",
          force_used: forceUsed,
        });
      } catch {
        /* audit must not mask success */
      }
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        await audit({
          tool: toolName,
          args,
          projectDir,
          verdict: "error",
          error: msg,
          error_class: classifyErrorMessage(msg),
          force_used: forceUsed,
        });
      } catch {
        /* audit must not mask the real error */
      }
      throw e;
    }
  };
}
