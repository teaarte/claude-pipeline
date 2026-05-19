/**
 * D8 / Q69 regression: continue-task translates `decision: "auto-apply"`
 * at gate-1 by substituting the stashed suggested-revision block as the
 * reject message and normalising the decision to "reject" before
 * mirroring to pipeline-state. Non-gate-1 use of auto-apply is rejected
 * as a protocol error.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeInitialDriverState, writeDriverState } from "../../../src/driver/core/state.js";
import { pipelineContinueTask } from "../../../src/driver/tools/continue-task.js";
import { pipelineInit } from "../../../src/tools/init.js";
import { readDriverState } from "../../../src/driver/core/state.js";
import type { DriverState } from "../../../src/driver/types/plugin.js";

async function setupMediumState(projectDir: string): Promise<DriverState> {
  await pipelineInit({
    project_dir: projectDir,
    task: "D8 auto-apply probe",
    task_id: "t-2026-05-19-d8autoapp",
    complexity: "medium",
    tests_mode: "regression-only",
    stack: { language: "TypeScript" },
  });
  const state = makeInitialDriverState({
    project_dir: projectDir,
    task: "D8 auto-apply probe",
    flow_name: "medium",
  });
  state.task_id = "t-2026-05-19-d8autoapp";
  state.decisions["complexity"] = "medium";
  state.decisions["tests_mode"] = "regression-only";
  // Pretend we're parked at gate-1 with a stashed suggested revision.
  state.pending_user_answer = { gate: "gate-1", message: "stub" };
  state.scratch["__gate_1_suggested_revision"] =
    "## Suggested revision (auto-derived)\n- (BLOCKING, race-condition) missing await on async cache write.";
  // Advance step_index past gate-1 so runFSM doesn't re-enter gate-1.run.
  // (We just want continue-task's user-answer branch to run and mirror.)
  state.step_index = 999;
  await writeDriverState(state);
  return state;
}

describe("D8 — continue-task user-answer auto-apply translation", () => {
  it("auto-apply at gate-1 substitutes the stashed suggested-revision as reject feedback", async () => {
    const proj = await mkdtemp(join(tmpdir(), "cp-d8-auto-apply-"));
    try {
      const state = await setupMediumState(proj);
      // continue-task will throw on FLOW_OVERFLOW from runFSM (step_index=999),
      // but the user-answer branch runs first. We catch the FLOW_OVERFLOW
      // response and assert the mirroring side-effects.
      const r = await pipelineContinueTask({
        project_dir: proj,
        driver_state_id: state.driver_state_id,
        input: {
          driver_state_id: state.driver_state_id,
          type: "user-answer",
          decision: "auto-apply",
        },
      });
      // FLOW_OVERFLOW is the expected error from running runFSM after the
      // user-answer is processed; what we care about is the scratch mutation.
      expect(r.status === "error" || r.status === "complete").toBe(true);
      const persisted = await readDriverState(proj);
      const stashed = persisted?.scratch["gate-1_decision"] as any;
      // auto-apply normalized to "reject" so gateStep + mirrorGateDecision
      // route through the existing reject path (covered by gate-mirror.test.ts).
      expect(stashed?.decision).toBe("reject");
      expect(stashed?.message).toContain("Suggested revision");
      expect(stashed?.message).toContain("missing await");
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });

  it("auto-apply rejected at non-gate-1 (e.g. gate-0) — protocol error", async () => {
    const proj = await mkdtemp(join(tmpdir(), "cp-d8-auto-apply-bad-"));
    try {
      const state = await setupMediumState(proj);
      // Move the pending answer to gate-0.
      state.pending_user_answer = { gate: "gate-0", message: "stub" };
      await writeDriverState(state);
      await expect(
        pipelineContinueTask({
          project_dir: proj,
          driver_state_id: state.driver_state_id,
          input: {
            driver_state_id: state.driver_state_id,
            type: "user-answer",
            decision: "auto-apply",
          },
        }),
      ).rejects.toThrow(/auto-apply.*gate-1/);
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });
});
