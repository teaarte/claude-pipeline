import { describe, it, expect } from "vitest";
import {
  MCPClientManager,
  type MCPClientTransport,
  type AuditEmitter,
} from "../../src/lib/mcp-client-manager.js";
import type { MCPClientPlugin } from "../../src/driver/types/plugin.js";

function makePlugin(overrides: Partial<MCPClientPlugin> = {}): MCPClientPlugin {
  return {
    name: "claude-mem",
    server_command: ["echo", "mock-mcp"],
    expose_tools: ["search", "timeline", "get_observations"],
    scope: "task",
    ...overrides,
  };
}

function makeSuccessTransport(advertised: string[]): MCPClientTransport {
  return {
    async spawn(_plugin) {
      return { process: null, handshake: { advertised_tools: advertised } };
    },
    async kill() {
      /* no-op for synthetic transport */
    },
  };
}

function makeFailingTransport(reason: string): MCPClientTransport {
  return {
    async spawn() {
      throw new Error(reason);
    },
    async kill() {
      /* no-op */
    },
  };
}

function captureAudit(): { audits: any[]; emit: AuditEmitter } {
  const audits: any[] = [];
  return { audits, emit: (entry) => void audits.push(entry) };
}

describe("MCPClientManager (item 6)", () => {
  it("spawns client and exposes the intersection of advertised + expose_tools", async () => {
    const { audits, emit } = captureAudit();
    const manager = new MCPClientManager(
      makeSuccessTransport(["search", "timeline", "get_observations", "extra"]),
      emit,
    );
    await manager.addClient(makePlugin());
    const tools = manager.getExposedTools();
    expect(tools.map((t) => t.tool).sort()).toEqual(
      ["get_observations", "search", "timeline"].sort(),
    );
    expect(audits.find((a) => a.event === "mcp-client-spawned")?.client).toBe("claude-mem");
  });

  it("filters out exposed tools the server didn't advertise", async () => {
    const { emit } = captureAudit();
    const manager = new MCPClientManager(
      makeSuccessTransport(["search"]),
      emit,
    );
    await manager.addClient(
      makePlugin({ expose_tools: ["search", "timeline", "get_observations"] }),
    );
    const tools = manager.getExposedTools().map((t) => t.tool);
    expect(tools).toEqual(["search"]);
  });

  it("graceful degrade: audit + skip when spawn fails", async () => {
    const { audits, emit } = captureAudit();
    const manager = new MCPClientManager(
      makeFailingTransport("boom"),
      emit,
    );
    await manager.addClient(makePlugin());
    expect(manager.getExposedTools()).toEqual([]);
    expect(audits.find((a) => a.event === "mcp-client-spawn-failed")?.detail).toContain("boom");
  });

  it("health_check: skips when the named tool isn't advertised", async () => {
    const { audits, emit } = captureAudit();
    const manager = new MCPClientManager(
      makeSuccessTransport(["other"]),
      emit,
    );
    await manager.addClient(
      makePlugin({
        health_check: { tool: "search", timeout_ms: 1000 },
      }),
    );
    expect(manager.getExposedTools()).toEqual([]);
    expect(audits.find((a) => a.event === "mcp-client-handshake-timeout")?.client).toBe(
      "claude-mem",
    );
  });

  it("scope=task: shutdown kills task-scoped clients only", async () => {
    const { audits, emit } = captureAudit();
    const manager = new MCPClientManager(
      makeSuccessTransport(["x", "y"]),
      emit,
    );
    await manager.addClient(makePlugin({ name: "task-client", expose_tools: ["x"], scope: "task" }));
    await manager.addClient(makePlugin({ name: "team-client", expose_tools: ["y"], scope: "team" }));
    await manager.shutdown("task");
    expect(manager._activeClientNames()).toEqual(["team-client"]);
    const killed = audits.filter((a) => a.event === "mcp-client-killed").map((a) => a.client);
    expect(killed).toEqual(["task-client"]);
  });

  it("getExposedTools returns empty when no clients registered", async () => {
    const manager = new MCPClientManager(makeSuccessTransport([]));
    expect(manager.getExposedTools()).toEqual([]);
  });
});
