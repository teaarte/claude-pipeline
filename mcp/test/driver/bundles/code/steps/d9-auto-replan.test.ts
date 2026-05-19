/**
 * D9 / Q70 regression: opt-in auto-replan loop at planning gate-1.
 *
 *  - auto_replan_on_blocking_max = 0 (default): gate-1 emits ask-user as
 *    today's manual gate.
 *  - cap >= 1 AND blocking planning findings exist AND used < cap →
 *    gate-1 step walks step_index back to PLAN (no human pause), audit
 *    row error_class: "auto-replan" emitted, scratch
 *    __auto_replan_count incremented.
 *  - At the cap, gate-1 falls through to the manual ask-user prompt.
 *  - No blocking findings → no auto-replan even if cap > 0 (only on
 *    BLOCKING; warn/info findings don't burn the cap).
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_STEPS } from "../../../../../src/driver/bundles/code/steps/index.js";
import { createRegistry } from "../../../../../src/driver/core/registry.js";
import { loadBundle } from "../../../../../src/driver/loaders/bundles.js";
import { makeInitialDriverState } from "../../../../../src/driver/core/state.js";
import type {
  DriverState,
  StepContext,
  StepPlugin,
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
      return "ar-d9-test-id";
    },
  };
}

async function writeFindings(projectDir: string, findings: any[]): Promise<void> {
  await mkdir(join(projectDir, ".claude"), { recursive: true });
  const body = findings.map((f) => JSON.stringify(f)).join("\n") + "\n";
  await writeFile(join(projectDir, ".claude", "findings.jsonl"), body, "utf8");
}

function blockingFinding(idSuffix: string, iter: number): any {
  return {
    schema_version: "1.0",
    id: `f-2026-05-19-d9${idSuffix}`,
    agent: "logic-reviewer",
    iteration: iter,
    task_id: "t-d9",
    severity: "blocking",
    category: "missing-evidence",
    summary: `D9 finding ${idSuffix}`,
    suggested_fix: "cite ROADMAP.md",
    status: "open",
  };
}

function baseState(projectDir: string): DriverState {
  const s = makeInitialDriverState({
    project_dir: projectDir,
    task: "D9 auto-replan probe",
    flow_name: "medium",
  });
  s.decisions["complexity"] = "medium";
  s.decisions["tests_mode"] = "regression-only";
  return s;
}

describe("D9 / Q70 — gate-1 auto-replan loop", () => {
  it("default cap=0 → gate-1 pauses for the human (existing behavior)", async () => {
    const proj = await mkdtemp(join(tmpdir(), "cp-d9-default-"));
    try {
      await writeFindings(proj, [blockingFinding("a", 1)]);
      const ctx = await makeCtx();
      const state = baseState(proj);
      // No bundleConfig in scratch → cap defaults to 0.
      const result = await getStep("gate-1").run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle") {
        expect(result.response.status).toBe("ask-user");
      }
      expect(state.scratch["__auto_replan_count"]).toBeUndefined();
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });

  it("cap=1 + blocking findings + count=0 → walks step_index back to PLAN, no askUser", async () => {
    const proj = await mkdtemp(join(tmpdir(), "cp-d9-walk-"));
    try {
      await writeFindings(proj, [blockingFinding("b", 1)]);
      const ctx = await makeCtx();
      const state = baseState(proj);
      state.scratch.bundleConfig = { auto_replan_on_blocking_max: 1 };
      const flow = ctx.registry.flows.get("medium")!;
      const planIdx = flow.steps.indexOf("plan");
      state.step_index = flow.steps.indexOf("gate-1");
      const result = await getStep("gate-1").run(state, ctx);
      expect(result.type).toBe("advance");
      // Pre-bumped to planIdx - 1 (runFSM increments after advance).
      expect(state.step_index).toBe(planIdx - 1);
      expect(state.scratch["__auto_replan_count"]).toBe(1);
      // No ask-user pause.
      expect(state.pending_user_answer).toBeNull();
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });

  it("at cap → falls through to manual ask-user prompt", async () => {
    const proj = await mkdtemp(join(tmpdir(), "cp-d9-cap-"));
    try {
      await writeFindings(proj, [blockingFinding("c", 2)]);
      const ctx = await makeCtx();
      const state = baseState(proj);
      state.scratch.bundleConfig = { auto_replan_on_blocking_max: 1 };
      state.scratch["__auto_replan_count"] = 1; // already used the only attempt.
      const result = await getStep("gate-1").run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle") {
        expect(result.response.status).toBe("ask-user");
      }
      // Counter unchanged.
      expect(state.scratch["__auto_replan_count"]).toBe(1);
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });

  it("no findings → no auto-replan, falls through to ask-user (avoid burning cap on empty findings)", async () => {
    const proj = await mkdtemp(join(tmpdir(), "cp-d9-nofindings-"));
    try {
      // No findings file at all.
      const ctx = await makeCtx();
      const state = baseState(proj);
      state.scratch.bundleConfig = { auto_replan_on_blocking_max: 2 };
      const result = await getStep("gate-1").run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle") {
        expect(result.response.status).toBe("ask-user");
      }
      expect(state.scratch["__auto_replan_count"]).toBeUndefined();
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });

  it("only warn/info findings → no auto-replan (cap reserved for BLOCKING only)", async () => {
    const proj = await mkdtemp(join(tmpdir(), "cp-d9-warn-"));
    try {
      await writeFindings(proj, [
        {
          schema_version: "1.0",
          id: "f-2026-05-19-d9warn1",
          agent: "logic-reviewer",
          iteration: 1,
          task_id: "t-d9",
          severity: "warn",
          category: "other",
          summary: "minor wording concern",
          status: "open",
        },
      ]);
      const ctx = await makeCtx();
      const state = baseState(proj);
      state.scratch.bundleConfig = { auto_replan_on_blocking_max: 2 };
      const result = await getStep("gate-1").run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle") {
        expect(result.response.status).toBe("ask-user");
      }
      expect(state.scratch["__auto_replan_count"]).toBeUndefined();
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });

  it("cap=2 + blocking + count=1 → second auto-replan iteration fires", async () => {
    const proj = await mkdtemp(join(tmpdir(), "cp-d9-iter2-"));
    try {
      await writeFindings(proj, [blockingFinding("d", 2)]);
      const ctx = await makeCtx();
      const state = baseState(proj);
      state.scratch.bundleConfig = { auto_replan_on_blocking_max: 2 };
      state.scratch["__auto_replan_count"] = 1;
      const flow = ctx.registry.flows.get("medium")!;
      const planIdx = flow.steps.indexOf("plan");
      state.step_index = flow.steps.indexOf("gate-1");
      const result = await getStep("gate-1").run(state, ctx);
      expect(result.type).toBe("advance");
      expect(state.step_index).toBe(planIdx - 1);
      expect(state.scratch["__auto_replan_count"]).toBe(2);
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });
});
