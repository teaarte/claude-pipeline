/**
 * MCPClientManager — owns the lifecycle of external MCP servers declared
 * by a project's pipeline.config.json `mcp_clients[]`. Item 6 of v2.2.5
 * ships the contract + spawn-lifecycle plumbing; live integration with
 * concrete servers (claude-mem, search MCPs, etc.) is config-level work
 * that happens after v2.2.5 merges.
 *
 * Responsibilities:
 *  - spawn(plugin) — fork the server process, perform MCP handshake
 *    (mocked via spawnFn in tests), cache the advertised tool list.
 *  - getExposedTools() — flatten plugin.expose_tools across all active
 *    clients into the set agents are allowed to call.
 *  - shutdown() — terminate task-scoped servers at pipeline_finish.
 *
 * Real-world MCP handshake (JSON-RPC over stdio) is plumbed via the
 * `transport` injected at construction. Default transport spawns via
 * node:child_process. Tests inject a synthetic transport so no actual
 * child process runs in CI.
 */

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import type { MCPClientPlugin } from "../driver/types/plugin.js";

export interface MCPHandshakeResult {
  /** Names of tools the server advertises. */
  advertised_tools: string[];
}

export interface MCPClientTransport {
  /**
   * Spawn the server process. Implementations choose how to do the
   * handshake (real MCP JSON-RPC, mocked, etc.) and return what the
   * server advertised.
   */
  spawn(plugin: MCPClientPlugin): Promise<{
    process: ChildProcess | null;
    handshake: MCPHandshakeResult;
  }>;
  /** Best-effort kill — for scope:"task" clients at pipeline_finish. */
  kill(process: ChildProcess | null): Promise<void>;
}

interface ActiveClient {
  plugin: MCPClientPlugin;
  process: ChildProcess | null;
  advertised_tools: string[];
  exposed_tools: string[];
}

export interface AuditEmitter {
  (entry: {
    event: "mcp-client-spawn-failed" | "mcp-client-handshake-timeout" | "mcp-client-spawned" | "mcp-client-killed";
    client: string;
    detail?: string;
  }): void | Promise<void>;
}

export class MCPClientManager {
  private clients: ActiveClient[] = [];

  constructor(
    private readonly transport: MCPClientTransport = defaultTransport(),
    private readonly audit: AuditEmitter = () => {},
  ) {}

  async addClient(plugin: MCPClientPlugin): Promise<void> {
    try {
      const { process, handshake } = await withTimeout(
        this.transport.spawn(plugin),
        plugin.health_check?.timeout_ms,
      );
      if (plugin.health_check) {
        if (!handshake.advertised_tools.includes(plugin.health_check.tool)) {
          await this.audit({
            event: "mcp-client-handshake-timeout",
            client: plugin.name,
            detail: `health_check tool '${plugin.health_check.tool}' not advertised`,
          });
          await this.transport.kill(process);
          return;
        }
      }
      const exposed = plugin.expose_tools.filter((t) =>
        handshake.advertised_tools.includes(t),
      );
      this.clients.push({
        plugin,
        process,
        advertised_tools: handshake.advertised_tools,
        exposed_tools: exposed,
      });
      await this.audit({ event: "mcp-client-spawned", client: plugin.name });
    } catch (e) {
      await this.audit({
        event: "mcp-client-spawn-failed",
        client: plugin.name,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Flatten exposed tools across all spawned clients. */
  getExposedTools(): { client: string; tool: string }[] {
    const out: { client: string; tool: string }[] = [];
    for (const c of this.clients) {
      for (const t of c.exposed_tools) out.push({ client: c.plugin.name, tool: t });
    }
    return out;
  }

  async shutdown(scope: "task" | "team" | "global" = "task"): Promise<void> {
    const keep: ActiveClient[] = [];
    for (const c of this.clients) {
      if (c.plugin.scope === scope) {
        await this.transport.kill(c.process);
        await this.audit({ event: "mcp-client-killed", client: c.plugin.name });
      } else {
        keep.push(c);
      }
    }
    this.clients = keep;
  }

  /** Test-only — inspect active clients without iterating exposed_tools. */
  _activeClientNames(): string[] {
    return this.clients.map((c) => c.plugin.name);
  }
}

function defaultTransport(): MCPClientTransport {
  return {
    async spawn(plugin) {
      // v2.2.5 stub: spawn the process but do NOT perform a real MCP
      // handshake yet. The handshake JSON-RPC implementation lands in v2.3
      // when the daemon ships. Until then, we trust plugin.expose_tools as
      // the advertised set so the client + AgentPlugin.mcp_tools slot work
      // end-to-end.
      const [cmd, ...args] = plugin.server_command;
      if (!cmd) {
        throw new Error(`mcp client '${plugin.name}' has empty server_command`);
      }
      const proc = nodeSpawn(cmd, args, {
        env: { ...process.env, ...(plugin.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });
      return {
        process: proc,
        handshake: { advertised_tools: [...plugin.expose_tools] },
      };
    },
    async kill(proc) {
      if (proc && !proc.killed) {
        proc.kill("SIGTERM");
      }
    },
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number | undefined): Promise<T> {
  if (!ms || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`mcp client spawn timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
