import { readFile, writeFile, mkdir, appendFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homeMetricsDir } from "./paths.js";
import { readStateSafe } from "./state-io.js";

export const AUDIT_GLOBAL_CAP = 10_000;

export type AuditVerdict = "ok" | "error" | "force_bypass";

export type AuditEntry = {
  schema_version: "1.0";
  ts: string;
  tool: string;
  task_id: string | null;
  project_dir: string | null;
  args_summary: Record<string, unknown>;
  verdict: AuditVerdict;
  error?: string;
  force_used: boolean;
};

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
 * Append to a JSONL file but cap total entries at `cap`. When over, rewrite
 * the file with the last `cap` entries (FIFO truncation). Cheap for our scale
 * (~1MB at 10k entries).
 */
async function appendCapped(file: string, entry: unknown, cap: number): Promise<void> {
  await ensureDir(file);
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
    // Atomic rewrite.
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, trimmed.join("\n") + "\n", "utf8");
    await rename(tmp, file);
    return;
  }
  // Below cap: simple append is enough.
  await appendFile(file, JSON.stringify(entry) + "\n", "utf8");
}

export type AuditCall = {
  tool: string;
  args: unknown;
  projectDir?: string | null;
  verdict: AuditVerdict;
  error?: string;
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

  await appendCapped(globalAuditFile(), entry, AUDIT_GLOBAL_CAP);
  if (projectDir) {
    await appendUncapped(projectAuditFile(projectDir), entry);
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
          force_used: forceUsed,
        });
      } catch {
        /* audit must not mask the real error */
      }
      throw e;
    }
  };
}
