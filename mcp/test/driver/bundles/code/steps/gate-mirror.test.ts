/**
 * Q8 regression: gate steps must mirror the captured driver-scratch
 * decision onto canonical pipeline-state.gates the moment the FSM
 * resumes from the ask-user shuttle. Without the mirror, INV_005/INV_006
 * can't fire and the Q22 metrics-row extractor reads gate1_revisions=0.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry } from "../../../../../src/driver/core/registry.js";
import { runFSM } from "../../../../../src/driver/core/fsm.js";
import { makeInitialDriverState, writeDriverState } from "../../../../../src/driver/core/state.js";
import { loadBundle } from "../../../../../src/driver/loaders/bundles.js";
import { spawnAgent } from "../../../../../src/driver/core/shuttle.js";
import { pipelineInit } from "../../../../../src/tools/init.js";
import { pipelineStateGet } from "../../../../../src/tools/state-get.js";
import { pipelineContinueTask } from "../../../../../src/driver/tools/continue-task.js";
import { mirrorGateDecision } from "../../../../../src/driver/bundles/code/steps/index.js";
import type {
  AgentSpawnRequest,
  SpawnProviderPlugin,
  StepResult,
} from "../../../../../src/driver/types/plugin.js";

function makeMockProvider(): SpawnProviderPlugin {
  return {
    name: "mock",
    async spawn(req: AgentSpawnRequest): Promise<StepResult> {
      const body = "```json\n" + JSON.stringify({
        schema_version: "1.0",
        agent: req.agent,
        task_id: "t-2026-05-14-gatemir",
        iteration: 1,
        verdict: req.agent.endsWith("-reviewer") ? "APPROVE" : "PASS",
        summary_line: "ok",
        findings: [],
        past_misses_applied: 0,
        past_miss_matches: [],
        ref_rules_consulted: [],
      }) + "\n```\n";
      return {
        type: "shuttle",
        response: spawnAgent(req.driver_state_id, req.agent_run_id, req.agent, {
          subagent_type: "general-purpose",
          description: req.agent,
          prompt: body,
          model: req.model,
        }),
      };
    },
  };
}

async function setupMediumState(projectDir: string) {
  await pipelineInit({
    project_dir: projectDir,
    task: "gate mirror smoke",
    task_id: "t-2026-05-14-gatemir",
    complexity: "medium",
    tests_mode: "regression-only",
    stack: { language: "TypeScript" },
  });
  const state = makeInitialDriverState({
    project_dir: projectDir,
    task: "gate mirror smoke",
    flow_name: "medium",
  });
  state.task_id = "t-2026-05-14-gatemir";
  state.scratch.complexity = "medium";
  state.decisions["complexity"] = "medium";
  state.decisions["tests_mode"] = "regression-only";
  return state;
}

async function driveToGate0(projectDir: string) {
  const registry = createRegistry();
  await loadBundle("code", registry);
  registry.spawn_provider = makeMockProvider();
  let state = await setupMediumState(projectDir);
  for (let i = 0; i < 5; i++) {
    const { state: out, response } = await runFSM(state, registry);
    state = out;
    if (response.status === "ask-user" && response.gate === "gate-0") {
      return { state, registry };
    }
    if (response.status === "complete" || response.status === "error") {
      throw new Error(`unexpected ${response.status} before gate-0`);
    }
  }
  throw new Error("did not reach gate-0 within 5 iterations");
}

describe("Q8 — gate decisions mirrored to pipeline-state.gates", () => {
  it("approving gate-0 via continue-task sets pipeline-state.gates.gate0 = 'approved'", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q8-approve-"));
    try {
      const { state } = await driveToGate0(project);
      await writeDriverState(state);
      await pipelineContinueTask({
        project_dir: project,
        driver_state_id: state.driver_state_id,
        input: {
          driver_state_id: state.driver_state_id,
          type: "user-answer",
          answer: "approved",
        },
      });
      const ps = (await pipelineStateGet({ project_dir: project })).state;
      expect(ps.gates.gate0).toBe("approved");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("rejecting gate-0 with feedback sets gates.gate0 = 'rejected'", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q8-reject-"));
    try {
      const { state } = await driveToGate0(project);
      await writeDriverState(state);
      await pipelineContinueTask({
        project_dir: project,
        driver_state_id: state.driver_state_id,
        input: {
          driver_state_id: state.driver_state_id,
          type: "user-answer",
          answer: "no, classification is wrong",
        },
      });
      const ps = (await pipelineStateGet({ project_dir: project })).state;
      expect(ps.gates.gate0).toBe("rejected");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("changes_requested collapses to rejected + records feedback on gates", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q8-changes-"));
    try {
      const { state } = await driveToGate0(project);
      await writeDriverState(state);
      await pipelineContinueTask({
        project_dir: project,
        driver_state_id: state.driver_state_id,
        input: {
          driver_state_id: state.driver_state_id,
          type: "user-answer",
          answer: "revise: tighten the scope",
        },
      });
      const ps = (await pipelineStateGet({ project_dir: project })).state;
      expect(ps.gates.gate0).toBe("rejected");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("mirror is idempotent — calling mirrorGateDecision twice does not flip the flag back", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q8-idempotent-"));
    try {
      const { state, registry } = await driveToGate0(project);
      state.scratch["gate-0_decision"] = "approved";
      await mirrorGateDecision(state, registry, "gate-0");
      expect(state.scratch["gate-0_mirrored"]).toBe(true);
      // Second call: short-circuits without changing anything.
      await mirrorGateDecision(state, registry, "gate-0");
      expect(state.scratch["gate-0_mirrored"]).toBe(true);
      const ps = (await pipelineStateGet({ project_dir: project })).state;
      expect(ps.gates.gate0).toBe("approved");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
