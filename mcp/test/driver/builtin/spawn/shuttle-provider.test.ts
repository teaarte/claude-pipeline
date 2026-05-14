import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shuttleSpawnProvider } from "../../../../src/driver/builtin/spawn/shuttle-provider.js";
import type { AgentSpawnRequest } from "../../../../src/driver/types/plugin.js";

function makeReq(overrides: Partial<AgentSpawnRequest> = {}): AgentSpawnRequest {
  return {
    agent: overrides.agent ?? "code-analyzer",
    agent_run_id: overrides.agent_run_id ?? "a-2026-05-14-aaaaaa",
    driver_state_id: overrides.driver_state_id ?? "d-2026-05-14-bbbbbb",
    phase: overrides.phase ?? "context",
    model: overrides.model ?? "sonnet",
    prompt:
      overrides.prompt ??
      "Spawn agent: code-analyzer. Project: /tmp/x. Task: investigate Q16.",
    template_path: overrides.template_path,
  };
}

describe("shuttleSpawnProvider", () => {
  it("forces subagent_type='general-purpose' regardless of agent name", async () => {
    const agents = ["planner", "code-analyzer", "logic-reviewer"];
    for (const agent of agents) {
      const r = await shuttleSpawnProvider.spawn(makeReq({ agent }));
      expect(r.type).toBe("shuttle");
      if (r.type !== "shuttle" || r.response.status !== "spawn-agent") {
        throw new Error("expected spawn-agent shuttle");
      }
      expect(r.response.claude_code_task.subagent_type).toBe("general-purpose");
      // The Task tool's accepted catalog — must always be one of these.
      const accepted = [
        "general-purpose",
        "Explore",
        "Plan",
        "runtime-debug-agent",
        "test-all-agent",
        "fe-test-all-agent",
        "statusline-setup",
        "claude-code-guide",
      ];
      expect(accepted).toContain(r.response.claude_code_task.subagent_type);
    }
  });

  it("embeds the agent name and the template content into the prompt", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cp-shuttle-tpl-"));
    try {
      const tplFile = join(tmpDir, "tpl.md");
      const templateBody =
        "You are the test-spec-agent. Follow ROLE INSTRUCTIONS exactly.";
      await writeFile(tplFile, templateBody, "utf8");
      const r = await shuttleSpawnProvider.spawn(
        makeReq({ agent: "test-spec-agent", template_path: tplFile }),
      );
      if (r.type !== "shuttle" || r.response.status !== "spawn-agent") {
        throw new Error("expected spawn-agent shuttle");
      }
      const prompt = r.response.claude_code_task.prompt;
      expect(prompt).toContain("test-spec-agent");
      expect(prompt).toContain(templateBody);
      // Spawn context (the upstream prompt) is preserved too.
      expect(prompt).toContain("Spawn agent: code-analyzer");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("sets a non-empty, short description for the Task tool UI", async () => {
    const r = await shuttleSpawnProvider.spawn(makeReq({ agent: "planner" }));
    if (r.type !== "shuttle" || r.response.status !== "spawn-agent") {
      throw new Error("expected spawn-agent shuttle");
    }
    const desc = r.response.claude_code_task.description;
    expect(desc.length).toBeGreaterThan(0);
    expect(desc.length).toBeLessThanOrEqual(80);
    expect(desc).toContain("planner");
  });

  it("does not put the AgentPlugin name into subagent_type even when template_path is missing", async () => {
    const r = await shuttleSpawnProvider.spawn(makeReq({ agent: "challenger-reviewer", template_path: undefined }));
    if (r.type !== "shuttle" || r.response.status !== "spawn-agent") {
      throw new Error("expected spawn-agent shuttle");
    }
    expect(r.response.claude_code_task.subagent_type).toBe("general-purpose");
    expect(r.response.claude_code_task.prompt).toContain("challenger-reviewer");
  });

  it("emits a recognisable marker when template_path cannot be read (does not throw)", async () => {
    const r = await shuttleSpawnProvider.spawn(
      makeReq({ agent: "planner", template_path: "/no/such/path/agents/planner.md" }),
    );
    if (r.type !== "shuttle" || r.response.status !== "spawn-agent") {
      throw new Error("expected spawn-agent shuttle");
    }
    expect(r.response.claude_code_task.prompt).toMatch(/template read failed/);
    expect(r.response.claude_code_task.subagent_type).toBe("general-purpose");
  });
});
