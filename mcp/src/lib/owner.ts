/**
 * v2.2.6 C8 / Q64: cross-session ownership helpers.
 *
 * The pipeline's mental model is "one project_dir = one active task" — but
 * with multiple Claude Code windows open in the same project, that
 * assumption breaks: window B trying to /done or /abandon can silently
 * destroy window A's in-flight state. The fix is a generic, platform-
 * agnostic `state.owner_id` field populated from an env-var chain at
 * `pipeline_run_task` time; finalizing tools (pipeline_finish,
 * pipeline_abandon) refuse cross-owner calls unless explicit
 * `force_cross_owner: true` is passed.
 *
 * CC-specific code lives ONLY in `hooks/pipeline-stop.sh`. Everything
 * here is opaque-string comparison; the integration layer is responsible
 * for setting the env vars (CC's MCP launcher today; future daemon HTTP
 * handler tomorrow).
 */

export const OWNER_ID_ENV_VARS = [
  "CLAUDE_PIPELINE_OWNER_ID",
  "CLAUDE_SESSION_ID",
  "SESSION_ID",
] as const;

/**
 * Read the current process's owner_id from the env-var chain. First
 * non-empty value wins; returns null if none set (allows pipeline to
 * keep working in tests / synthetic harnesses with no env wiring).
 */
export function currentOwnerId(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const name of OWNER_ID_ENV_VARS) {
    const v = env[name];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export type OwnerCheckResult =
  | { kind: "match" }
  | { kind: "no-owner-recorded" }
  | { kind: "no-current-owner" }
  | { kind: "mismatch"; expected: string; actual: string | null };

/**
 * Compare the state's recorded owner with the current process's owner_id.
 * Returns a structured result so callers can decide the policy
 * (refuse vs. force-with-audit vs. silently allow).
 */
export function ownerCheck(
  stateOwnerId: string | null | undefined,
  current: string | null,
): OwnerCheckResult {
  if (!stateOwnerId) return { kind: "no-owner-recorded" };
  if (!current) return { kind: "no-current-owner" };
  if (stateOwnerId === current) return { kind: "match" };
  return { kind: "mismatch", expected: stateOwnerId, actual: current };
}

export const OWNER_MISMATCH_CODE = "OWNER_MISMATCH";
export const CROSS_OWNER_VIOLATION = "cross-owner-finalize";
