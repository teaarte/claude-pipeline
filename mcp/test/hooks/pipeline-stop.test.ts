import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(__dirname, "..", "..", "..", "hooks", "pipeline-stop.sh");

function runHook(cwd: string, stop_hook_active = false) {
  const payload = JSON.stringify({ cwd, stop_hook_active });
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
      current_step: "STEP 1",
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
});
