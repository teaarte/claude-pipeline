// Integration test: pipes each fixture into hooks/pipeline-guard.sh and
// asserts the guard issued a 'deny' decision. Also covers fail-open behavior
// (no marker → allow), bypass marker (within TTL → allow), and the removal
// of the legacy PIPELINE_ALLOW_RAW env-var escape hatch.

import { describe, it, expect, beforeAll } from "vitest";
import { spawn } from "node:child_process";
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { tempProject } from "./helpers/setup.js";
import { pipelineInit } from "../src/tools/init.js";
import { pipelineUnlockWrites, pipelineRelockWrites } from "../src/tools/unlock-writes.js";
import { initArgs } from "./helpers/setup.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const GUARD_SH = join(PROJECT_ROOT, "hooks", "pipeline-guard.sh");
const FIXTURES_DIR = join(PROJECT_ROOT, "tests", "guard-evasion");

type GuardResult = { permissionDecision?: "deny" } | null;

async function runGuard(input: any, env: Record<string, string> = {}): Promise<GuardResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bash", [GUARD_SH], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", () => {
      const trimmed = stdout.trim();
      if (!trimmed) return resolve(null);
      try {
        resolve(JSON.parse(trimmed)?.hookSpecificOutput ?? null);
      } catch {
        reject(new Error(`Guard returned non-JSON: ${stdout} (stderr: ${stderr})`));
      }
    });
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

async function listFixtures(): Promise<string[]> {
  const names = await readdir(FIXTURES_DIR);
  return names.filter((n) => n.endsWith(".json")).sort();
}

describe("pipeline-guard.sh — 12 evasion fixtures", () => {
  let projectDir: string;

  beforeAll(async () => {
    // Create one project for all fixtures, with marker present.
    const proj = await tempProject();
    projectDir = proj.dir;
    await pipelineInit(initArgs(projectDir));
    // Ensure marker is in place.
    const markerExists = await readFile(join(projectDir, ".claude", ".mcp-managed")).then(
      () => true,
      () => false,
    );
    expect(markerExists).toBe(true);
  });

  it("verifies fixture count is at least 12", async () => {
    const fixtures = await listFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
  });

  it("blocks every fixture with permissionDecision=deny", async () => {
    const fixtures = await listFixtures();
    for (const name of fixtures) {
      const raw = await readFile(join(FIXTURES_DIR, name), "utf8");
      const payload = JSON.parse(raw);
      // Substitute the placeholder PROJECT_DIR with the real path so the
      // guard's path-based protected-RE actually matches and the marker
      // walk finds .mcp-managed.
      if (payload.tool_input.command) {
        payload.tool_input.command = payload.tool_input.command.replace(/PROJECT_DIR/g, projectDir);
      }
      if (payload.tool_input.file_path) {
        payload.tool_input.file_path = payload.tool_input.file_path.replace(/PROJECT_DIR/g, projectDir);
      }
      const result = await runGuard(payload);
      expect(result?.permissionDecision, `fixture ${name} was NOT blocked: ${JSON.stringify(result)}`).toBe("deny");
    }
  }, 20_000);
});

describe("pipeline-guard.sh — scoping & bypass", () => {
  it("fails-open when no .mcp-managed marker exists in ancestor chain", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cp-guard-nomarker-"));
    try {
      await mkdir(join(dir, ".claude"), { recursive: true });
      const fakeFile = join(dir, ".claude", "pipeline-state.json");
      await writeFile(fakeFile, "{}", "utf8");
      const result = await runGuard({
        tool_name: "Bash",
        tool_input: { command: `rm ${fakeFile}` },
      });
      // No marker → guard exits without emitting JSON.
      expect(result).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks Write tool when marker is present", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const result = await runGuard({
        tool_name: "Write",
        tool_input: { file_path: join(proj.dir, ".claude", "pipeline-state.json") },
      });
      expect(result?.permissionDecision).toBe("deny");
    } finally {
      await proj.cleanup();
    }
  });

  it("PIPELINE_ALLOW_RAW=1 has NO effect (escape hatch removed)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const result = await runGuard(
        {
          tool_name: "Write",
          tool_input: { file_path: join(proj.dir, ".claude", "pipeline-state.json") },
        },
        { PIPELINE_ALLOW_RAW: "1" },
      );
      expect(result?.permissionDecision).toBe("deny");
    } finally {
      await proj.cleanup();
    }
  });

  it("pipeline_unlock_writes allows the next write; pipeline_relock_writes blocks again", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      // Block without bypass.
      let result = await runGuard({
        tool_name: "Write",
        tool_input: { file_path: join(proj.dir, ".claude", "pipeline-state.json") },
      });
      expect(result?.permissionDecision).toBe("deny");

      // Unlock and verify write is allowed.
      await pipelineUnlockWrites({ project_dir: proj.dir, ttl_seconds: 300, reason: "test" });
      result = await runGuard({
        tool_name: "Write",
        tool_input: { file_path: join(proj.dir, ".claude", "pipeline-state.json") },
      });
      expect(result?.permissionDecision).not.toBe("deny");

      // Relock and verify block returns.
      await pipelineRelockWrites({ project_dir: proj.dir });
      result = await runGuard({
        tool_name: "Write",
        tool_input: { file_path: join(proj.dir, ".claude", "pipeline-state.json") },
      });
      expect(result?.permissionDecision).toBe("deny");
    } finally {
      await proj.cleanup();
    }
  });

  it("expired bypass marker is NOT honored", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      // Hand-craft an expired marker.
      const past = new Date(Date.now() - 60 * 1000).toISOString();
      await writeFile(
        join(proj.dir, ".claude", ".mcp-bypass-allowed"),
        JSON.stringify({ schema_version: "1.0", expires_at: past, reason: "expired", issued_by_task_id: null }),
        "utf8",
      );
      const result = await runGuard({
        tool_name: "Write",
        tool_input: { file_path: join(proj.dir, ".claude", "pipeline-state.json") },
      });
      expect(result?.permissionDecision).toBe("deny");
    } finally {
      await proj.cleanup();
    }
  });

  it("reads pass through (cat / grep / jq)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const result = await runGuard({
        tool_name: "Bash",
        tool_input: { command: `cat ${join(proj.dir, ".claude", "pipeline-state.json")}` },
      });
      expect(result).toBeNull();
    } finally {
      await proj.cleanup();
    }
  });
});
