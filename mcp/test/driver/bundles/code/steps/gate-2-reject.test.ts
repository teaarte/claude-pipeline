/**
 * Q74 / D13 regression: gate-2 reject FSM-control-flow fix.
 *
 * Before D13: gate-2 reject silently advanced step_index past the gate; the
 * FSM ran FINALIZE with state.verdict=null, which defaulted to "accepted".
 * pipeline-state.gates.gate2 read "rejected" + gate2_revisions=1 while the
 * metric row carried verdict="accepted" — internally inconsistent. The user's
 * primary veto mechanism at gate-2 was non-functional.
 *
 * After D13:
 * - gate-2 accept → state.verdict="accepted", FSM advances to FINALIZE.
 * - gate-2 reject + reject_intent="abandon" → state.verdict="rejected",
 *   FSM advances to FINALIZE with explicit rejected verdict.
 * - gate-2 reject (default reject_intent="revise") → step_index walks back
 *   to the impl phase entry, impl-phase scratch markers cleared, gate-2
 *   decision cleared so the second pass re-prompts the human.
 * - FINALIZE.run throws INV_inconsistent-finalize if it ever sees a null
 *   verdict — the load-bearing safety net under the new control flow.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry } from "../../../../../src/driver/core/registry.js";
import { loadBundle } from "../../../../../src/driver/loaders/bundles.js";
import { makeInitialDriverState } from "../../../../../src/driver/core/state.js";
import { BUILTIN_STEPS } from "../../../../../src/driver/bundles/code/steps/index.js";
import type {
  DriverState,
  StepContext,
  StepPlugin,
  UserAnswer,
} from "../../../../../src/driver/types/plugin.js";

function getStep(name: string): StepPlugin {
  const step = BUILTIN_STEPS.find((s) => s.name === name);
  if (!step) throw new Error(`step '${name}' not registered`);
  return step;
}

async function makeCtx(): Promise<StepContext> {
  const reg = createRegistry();
  await loadBundle("code", reg);
  return {
    registry: reg,
    async beginSpawn() {
      return "ar-test-fixed-id";
    },
  };
}

function baseState(projectDir: string): DriverState {
  const s = makeInitialDriverState({
    project_dir: projectDir,
    task: "gate-2 reject regression",
    flow_name: "medium",
  });
  s.decisions["complexity"] = "medium";
  s.decisions["tests_mode"] = "regression-only";
  return s;
}

describe("Q74 / D13 — gate-2 reject FSM control flow", () => {
  it("gate-2 accept sets state.verdict='accepted' and advances", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q74-accept-"));
    try {
      const state = baseState(project);
      state.scratch["gate-2_decision"] = { decision: "accept" } satisfies UserAnswer;
      const result = await getStep("gate-2").run(state, await makeCtx());
      expect(result.type).toBe("advance");
      expect(state.verdict).toBe("accepted");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("gate-2 reject + reject_intent=abandon sets verdict='rejected' and advances", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q74-abandon-"));
    try {
      const state = baseState(project);
      state.scratch["gate-2_decision"] = {
        decision: "reject",
        reject_intent: "abandon",
        message: "rolling back, fundamental approach wrong",
      } satisfies UserAnswer;
      const result = await getStep("gate-2").run(state, await makeCtx());
      expect(result.type).toBe("advance");
      expect(state.verdict).toBe("rejected");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("gate-2 reject + reject_intent=revise walks step_index back to impl entry", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q74-revise-"));
    try {
      const ctx = await makeCtx();
      // Find the impl-phase entry index in the MEDIUM flow.
      const flow = ctx.registry.flows.get("medium")!;
      const implEntry = flow.steps.findIndex((n) => {
        const sp = ctx.registry.steps.get(n);
        return sp?.phase === "implementation";
      });
      expect(implEntry).toBeGreaterThan(0);

      const state = baseState(project);
      // Pretend gate-2 ran at its position; record some impl-phase markers
      // we expect the revise path to clear.
      state.step_index = flow.steps.indexOf("gate-2");
      state.scratch["__spawn_issued_implement"] = "ar-old-impl";
      state.scratch["__review_agents_issued"] = ["ar-r1", "ar-r2"];
      // Note: agent_output_* entries are history, not cleared — only the
      // re-spawn short-circuit markers and gate-2 decision get cleared.
      state.scratch["agent_output_ar-old-impl"] = "stale impl output";

      state.scratch["gate-2_decision"] = {
        decision: "reject",
        reject_intent: "revise",
        message: "prettier blockers still open on changed files",
      } satisfies UserAnswer;

      const result = await getStep("gate-2").run(state, ctx);
      expect(result.type).toBe("advance");
      // Pre-bumped to implEntry-1 because runFSM increments after advance.
      expect(state.step_index).toBe(implEntry - 1);
      // Revise must NOT default verdict — gate-2 hasn't accepted yet.
      expect(state.verdict).toBeNull();
      // Spawn-issued markers cleared so the next impl pass re-spawns fresh.
      expect(state.scratch["__spawn_issued_implement"]).toBeUndefined();
      expect(state.scratch["__review_agents_issued"]).toBeUndefined();
      // gate-2 decision cleared so the next pass re-prompts the human.
      expect(state.scratch["gate-2_decision"]).toBeUndefined();
      expect(state.scratch["gate-2_mirrored"]).toBeUndefined();
      // History (agent_output_*) is preserved.
      expect(state.scratch["agent_output_ar-old-impl"]).toBe("stale impl output");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("gate-2 reject without explicit reject_intent defaults to revise (backward consistency)", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q74-default-"));
    try {
      const ctx = await makeCtx();
      const state = baseState(project);
      const flow = ctx.registry.flows.get("medium")!;
      state.step_index = flow.steps.indexOf("gate-2");
      // No reject_intent — must default to "revise".
      state.scratch["gate-2_decision"] = {
        decision: "reject",
        message: "feedback",
      } satisfies UserAnswer;
      const result = await getStep("gate-2").run(state, ctx);
      expect(result.type).toBe("advance");
      expect(state.verdict).toBeNull();
      // step_index moved backwards (pre-bumped to impl entry - 1).
      expect(state.step_index).toBeLessThan(flow.steps.indexOf("gate-2"));
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("FINALIZE throws INV_inconsistent-finalize when state.verdict is null", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q74-inv-"));
    try {
      const state = baseState(project);
      expect(state.verdict).toBeNull();
      await expect(getStep("finalize").run(state, await makeCtx())).rejects.toThrow(
        /INV_inconsistent-finalize/,
      );
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("FINALIZE proceeds normally with verdict='accepted'", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q74-finalize-accept-"));
    try {
      const state = baseState(project);
      state.verdict = "accepted";
      const result = await getStep("finalize").run(state, await makeCtx());
      expect(result.type).toBe("halt");
      if (result.type === "halt" && result.response.status === "complete") {
        expect(result.response.verdict).toBe("accepted");
      }
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("FINALIZE proceeds normally with verdict='rejected' (after gate-2 abandon)", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q74-finalize-reject-"));
    try {
      const state = baseState(project);
      state.verdict = "rejected";
      const result = await getStep("finalize").run(state, await makeCtx());
      expect(result.type).toBe("halt");
      if (result.type === "halt" && result.response.status === "complete") {
        expect(result.response.verdict).toBe("rejected");
      }
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
