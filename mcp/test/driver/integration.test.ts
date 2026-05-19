import { describe, it, expect } from "vitest";
import { pipelineRunTask } from "../../src/driver/tools/run-task.js";
import { pipelineContinueTask } from "../../src/driver/tools/continue-task.js";
import { tempProject } from "../helpers/setup.js";
import { readDriverState } from "../../src/driver/core/state.js";

describe("driver/tools — pipeline_run_task + pipeline_continue_task", () => {
  it("returns a spawn-agent shuttle on first call (simple flow)", async () => {
    const proj = await tempProject();
    try {
      const res = await pipelineRunTask({
        project_dir: proj.dir,
        task: "rename a single function",
        complexity_hint: "simple",
      });
      // D1 / Q-classifier-auto-spawn: the first non-trivial spawn is now the
      // classifier-agent (CLASSIFY_AGENT step in context phase). Delivering
      // its result then advances to PLAN which spawns the planner.
      expect(res.status).toBe("spawn-agent");
      if (res.status === "spawn-agent") {
        expect(res.agent).toBe("classifier");
        // D4 / Q65: runner-agnostic shuttle response shape. The CC-specific
        // subagent_type lives under extras now.
        expect(res.spawn_request.runner_hint).toBe("claude-code-task");
        expect((res.spawn_request.extras as any)?.subagent_type).toBe(
          "general-purpose",
        );
        expect(res.spawn_request.prompt).toContain("classifier");
        // Model resolves via defaultConfig.default_models_by_phase.context =
        // "sonnet", overriding the classifier's haiku default at the phase
        // layer (resolveAgentModel cascade).
        expect(res.spawn_request.model).toBe("sonnet");

        const res2 = await pipelineContinueTask({
          project_dir: proj.dir,
          driver_state_id: res.driver_state_id,
          input: {
            driver_state_id: res.driver_state_id,
            type: "agent-result",
            agent_run_id: res.agent_run_id,
            agent_output:
              "```json\n" +
              JSON.stringify({
                schema_version: "1.1",
                agent: "classifier",
                task_id: null,
                task_short: "rename-fn",
                refs_to_load: [],
                security_needed: false,
                antipattern_rules_applicable: [],
                stack: null,
                change_kind: null,
              }) +
              "\n```\n",
          },
        });
        expect(res2.status).toBe("spawn-agent");
        if (res2.status === "spawn-agent") {
          expect(res2.agent).toBe("planner");
          expect(res2.spawn_request.model).toBe("opus");
        }
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("resumes with agent-result and advances", async () => {
    const proj = await tempProject();
    try {
      const r1 = await pipelineRunTask({
        project_dir: proj.dir,
        task: "rename a single function",
        complexity_hint: "simple",
      });
      expect(r1.status).toBe("spawn-agent");
      if (r1.status !== "spawn-agent") return;

      const stateBefore = await readDriverState(proj.dir);
      expect(stateBefore?.pending_spawns[r1.agent_run_id]).toBeTruthy();

      // D1: first spawn is the classifier; deliver a stub output then resume.
      // The next pause should be the planner spawn (or any later shuttle).
      const r2 = await pipelineContinueTask({
        project_dir: proj.dir,
        driver_state_id: r1.driver_state_id,
        input: {
          driver_state_id: r1.driver_state_id,
          type: "agent-result",
          agent_run_id: r1.agent_run_id,
          agent_output:
            "```json\n" +
            JSON.stringify({
              schema_version: "1.1",
              agent: "classifier",
              task_id: null,
              task_short: "rename-fn",
              refs_to_load: [],
              security_needed: false,
              antipattern_rules_applicable: [],
              stack: null,
              change_kind: null,
            }) +
            "\n```\n",
        },
      });
      expect(["spawn-agent", "ask-user", "complete", "error"]).toContain(r2.status);
      const stateAfter = await readDriverState(proj.dir);
      expect(stateAfter?.pending_spawns[r1.agent_run_id]).toBeUndefined();
    } finally {
      await proj.cleanup();
    }
  });

  it("each agent-result advances step_index — successive spawns name DIFFERENT agents (regression for re-spawn loop)", async () => {
    const NONREVIEW = new Set([
      "classifier",
      "planner",
      "implementer",
      "architect",
      "code-analyzer",
      "dependency-auditor",
      "research",
      "migration",
    ]);
    const REVIEWER = new Set([
      "logic-reviewer",
      "challenger-reviewer",
      "style-reviewer",
      "security",
      "performance",
    ]);
    function buildOutput(agent: string, taskId: string): string {
      if (agent === "classifier") {
        // D1: classifier output is parsed against classifier-output.schema.json
        // — emit a valid stub so handleClassifierOutput populates state.decisions.
        return (
          "```json\n" +
          JSON.stringify({
            schema_version: "1.1",
            agent: "classifier",
            task_id: taskId,
            task_short: "rename-fn",
            refs_to_load: [],
            security_needed: false,
            antipattern_rules_applicable: [],
            stack: null,
            change_kind: null,
          }) +
          "\n```\n"
        );
      }
      if (NONREVIEW.has(agent)) {
        return `# ${agent} reply\n\nnarrative only — no JSON header parsed for nonreview agents.\n`;
      }
      if (REVIEWER.has(agent)) {
        return (
          "```json\n" +
          JSON.stringify({
            schema_version: "1.0",
            agent,
            task_id: taskId,
            iteration: 1,
            verdict: "APPROVE",
            summary_line: "looks good",
            findings: [],
            past_misses_applied: 0,
            past_miss_matches: [],
            ref_rules_consulted: [],
          }) +
          "\n```\n"
        );
      }
      // validator
      return (
        "```json\n" +
        JSON.stringify({
          schema_version: "1.0",
          agent,
          task_id: taskId,
          iteration: 1,
          verdict: "PASS",
          summary_line: "ok",
          findings: [],
          details: {},
        }) +
        "\n```\n"
      );
    }

    const proj = await tempProject();
    try {
      let res = await pipelineRunTask({
        project_dir: proj.dir,
        task: "rename a single function",
        complexity_hint: "simple",
        stack: { language: "TypeScript" },
      });
      const agentsSeen: string[] = [];
      let safety = 30;
      while (res.status !== "complete" && res.status !== "error" && safety-- > 0) {
        if (res.status === "spawn-agent") {
          agentsSeen.push(res.agent);
          const out = buildOutput(res.agent, "t-2026-05-13-rename-a-single-function");
          res = await pipelineContinueTask({
            project_dir: proj.dir,
            driver_state_id: res.driver_state_id,
            input: {
              driver_state_id: res.driver_state_id,
              type: "agent-result",
              agent_run_id: res.agent_run_id,
              agent_output: out,
            },
          });
        } else if (res.status === "ask-user") {
          res = await pipelineContinueTask({
            project_dir: proj.dir,
            driver_state_id: res.driver_state_id,
            input: {
              driver_state_id: res.driver_state_id,
              type: "user-answer",
              decision: "accept",
            },
          });
        }
      }
      expect(safety, `FSM did not converge — agents seen: ${agentsSeen.join(", ")}`).toBeGreaterThan(0);
      // Different STEPS may spawn the same agent (e.g. logic-reviewer at
      // plan-review AND review), but in the simple flow each agent runs
      // exactly once — duplicate names here indicate the re-spawn loop bug
      // is back.
      const dupes = agentsSeen.filter((a, i) => agentsSeen.indexOf(a) !== i);
      expect(dupes, `duplicate agent spawns indicate re-spawn loop: ${dupes.join(", ")}`).toEqual([]);
    } finally {
      await proj.cleanup();
    }
  }, 15_000);

  it("rejects continue with mismatched driver_state_id", async () => {
    const proj = await tempProject();
    try {
      const r1 = await pipelineRunTask({
        project_dir: proj.dir,
        task: "x",
        complexity_hint: "simple",
      });
      if (r1.status !== "spawn-agent") throw new Error(`unexpected ${r1.status}`);
      await expect(
        pipelineContinueTask({
          project_dir: proj.dir,
          driver_state_id: "ds-wrong-0000-0000-0000-000000000000",
          input: {
            driver_state_id: "ds-wrong-0000-0000-0000-000000000000",
            type: "agent-result",
            agent_run_id: r1.agent_run_id,
            agent_output: "x",
          },
        }),
      ).rejects.toThrow(/mismatch/);
    } finally {
      await proj.cleanup();
    }
  });
});

describe("driver framework extensibility (item 13 prep)", () => {
  it("custom AgentPlugin registers without touching core", async () => {
    // Smoke: import core/registry directly, add a synthetic plugin, query it.
    const { createRegistry, requireAgent } = await import("../../src/driver/core/registry.js");
    const r = createRegistry();
    r.agents.set("custom-accessibility-reviewer", {
      name: "custom-accessibility-reviewer",
      template_path: "agents/custom-accessibility-reviewer.md",
      output_schema: "reviewer",
      default_model: "sonnet",
    });
    const found = requireAgent(r, "custom-accessibility-reviewer");
    expect(found.name).toBe("custom-accessibility-reviewer");
    expect(found.default_model).toBe("sonnet");
  });
});
