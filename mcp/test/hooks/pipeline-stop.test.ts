import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(__dirname, "..", "..", "..", "hooks", "pipeline-stop.sh");

function runHook(cwd: string, stop_hook_active = false, session_id?: string) {
  const payload = JSON.stringify({
    cwd,
    stop_hook_active,
    ...(session_id ? { session_id } : {}),
  });
  return spawnSync("bash", [HOOK], {
    input: payload,
    encoding: "utf8",
  });
}

function setupProject(): string {
  const root = mkdtempSync(join(tmpdir(), "stop-hook-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  return root;
}

function writePipelineState(root: string, partial: Record<string, unknown>) {
  writeFileSync(
    join(root, ".claude", "pipeline-state.json"),
    JSON.stringify({
      schema_version: "1.0",
      task_id: "t-2026-05-15-stoptest",
      verdict: null,
      agents_count: 0,
      complexity: "medium",
      ...partial,
    }),
  );
}

function writeDriverState(root: string, partial: Record<string, unknown>) {
  writeFileSync(
    join(root, ".claude", "driver-state.json"),
    JSON.stringify({
      driver_state_id: "ds-test",
      flow_name: "medium",
      step_index: 3,
      complete: false,
      verdict: null,
      pending_user_answer: null,
      pending_spawns: [],
      scratch: {},
      decisions: {},
      ...partial,
    }),
  );
}

describe("pipeline-stop hook — Q24", () => {
  let root: string;

  beforeEach(() => {
    root = setupProject();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("blocks stop when pipeline in flight AND no pending_user_answer (existing behavior)", () => {
    writePipelineState(root, { verdict: null });
    writeDriverState(root, { pending_user_answer: null });

    const res = runHook(root);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"decision": "block"');
    expect(res.stdout).toContain("Pipeline is in flight");
    // Q10: in-flight diagnostic now reads flow_name + step_index from
    // driver-state.json. The fixture sets flow="medium" step=3.
    expect(res.stdout).toContain("flow=medium step=3");
    // Q10: hard guarantee the deprecated literal never reappears.
    expect(res.stdout).not.toContain("STEP 1");
  });

  it("stays SILENT when pipeline paused at gate with pending_user_answer set (Q24)", () => {
    writePipelineState(root, { verdict: null });
    writeDriverState(root, {
      pending_user_answer: {
        gate: "gate-0",
        question: "Does this classification look right?",
      },
    });

    const res = runHook(root);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  it("stays silent when driver-state.json is missing entirely (degraded — assume not gate-paused)", () => {
    writePipelineState(root, { verdict: null });
    const res = runHook(root);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"decision": "block"');
    // Q10: with driver-state absent, the step label falls back to "unknown"
    // instead of leaking the deprecated current_step="STEP 1".
    expect(res.stdout).toContain("unknown");
    expect(res.stdout).not.toContain("STEP 1");
  });

  it("stays silent on completed task (verdict set)", () => {
    writePipelineState(root, { verdict: "accepted", agents_count: 5 });
    writeDriverState(root, { complete: true, verdict: "accepted" });
    const res = runHook(root);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  it("falls back to stderr diagnostic when stop_hook_active=true (no double-block)", () => {
    writePipelineState(root, { verdict: null });
    writeDriverState(root, { pending_user_answer: null });
    const res = runHook(root, true);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("stop_hook_active");
  });

  it("emits pipeline_violation diagnostic when agents_count=0 on closed non-simple task", () => {
    writePipelineState(root, {
      verdict: "accepted",
      agents_count: 0,
      complexity: "medium",
    });
    const res = runHook(root);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("PIPELINE VIOLATION");
  });

  it("Q36: gate2=approved + verdict null → blocks with positive 'finalize' message, not 'in flight'", () => {
    writePipelineState(root, {
      verdict: null,
      gates: {
        gate0: "approved",
        gate1: "approved",
        gate2: "approved",
        gate1_feedback: "approve",
        gate2_feedback: "accept",
      },
    });
    writeDriverState(root, {
      complete: true,
      verdict: "accepted",
      pending_user_answer: null,
    });

    const res = runHook(root);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"decision": "block"');
    expect(res.stdout).toContain("Task accepted at Gate 2");
    expect(res.stdout).toContain("/done");
    expect(res.stdout).not.toContain("Pipeline is in flight");
    expect(res.stdout).not.toContain("STEP 1");
  });

  it("Q36: gate2=accepted (legacy verbiage) also recognized", () => {
    writePipelineState(root, {
      verdict: null,
      gates: {
        gate0: "approved",
        gate1: "approved",
        gate2: "accepted",
        gate1_feedback: null,
        gate2_feedback: "accept",
      },
    });
    writeDriverState(root, { pending_user_answer: null });

    const res = runHook(root);
    expect(res.stdout).toContain("Task accepted at Gate 2");
  });

  it("Q36: gate2=pending → falls through to original 'in flight' block message", () => {
    writePipelineState(root, {
      verdict: null,
      gates: {
        gate0: "approved",
        gate1: "approved",
        gate2: "pending",
        gate1_feedback: "approve",
        gate2_feedback: null,
      },
    });
    writeDriverState(root, { pending_user_answer: null });

    const res = runHook(root);
    expect(res.stdout).toContain("Pipeline is in flight");
    expect(res.stdout).not.toContain("Task accepted at Gate 2");
  });

  // v2.2.6 C8 / Q64: cross-session safety — Stop hook in a NON-owner window
  // must not block + must not suggest /done.
  it("Q64: NON-owner session (different session_id) gets INFO line + clean exit, does NOT block", () => {
    writePipelineState(root, {
      verdict: null,
      owner_id: "session-A-the-task-owner",
    });
    writeDriverState(root, { pending_user_answer: null });
    const res = runHook(root, false, "session-B-different-window");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(""); // no decision-block JSON to stdout
    expect(res.stderr).toContain("INFO");
    expect(res.stderr).toContain("different Claude Code session");
    expect(res.stderr).toContain("Do NOT run /done here");
  });

  it("Q64: owner session_id matches state.owner_id → existing block behavior preserved", () => {
    writePipelineState(root, {
      verdict: null,
      owner_id: "session-A",
    });
    writeDriverState(root, { pending_user_answer: null });
    const res = runHook(root, false, "session-A");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"decision": "block"');
    expect(res.stdout).toContain("Pipeline is in flight");
  });

  it("Q64: state without owner_id (legacy) → existing block behavior preserved (no early-out)", () => {
    writePipelineState(root, { verdict: null }); // no owner_id field
    writeDriverState(root, { pending_user_answer: null });
    const res = runHook(root, false, "session-B");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"decision": "block"');
  });
});
