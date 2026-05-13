import { describe, it, expect, afterEach } from "vitest";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tempProject, initArgs, clearMetrics } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import {
  pipelineUnlockWrites,
  pipelineRelockWrites,
  readBypassMarker,
  UNLOCK_DEFAULT_TTL_SECONDS,
  UNLOCK_MAX_TTL_SECONDS,
} from "../../src/tools/unlock-writes.js";

describe("pipeline_unlock_writes / pipeline_relock_writes", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("writes the bypass marker with TTL", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const r = await pipelineUnlockWrites({ project_dir: proj.dir, ttl_seconds: 60, reason: "test" });
      expect(r.ttl_seconds).toBe(60);
      expect(r.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      await access(r.marker_file, constants.F_OK);
      const body = await readBypassMarker(proj.dir);
      expect(body.reason).toBe("test");
      expect(body.issued_by_task_id).toBe("t-2026-05-13-test");
    } finally {
      await proj.cleanup();
    }
  });

  it("uses default TTL when omitted", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const r = await pipelineUnlockWrites({ project_dir: proj.dir, reason: "default ttl" });
      expect(r.ttl_seconds).toBe(UNLOCK_DEFAULT_TTL_SECONDS);
    } finally {
      await proj.cleanup();
    }
  });

  it("relock removes the marker (idempotent on second call)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineUnlockWrites({ project_dir: proj.dir, ttl_seconds: 60, reason: "x" });
      const r1 = await pipelineRelockWrites({ project_dir: proj.dir });
      expect(r1.marker_existed).toBe(true);
      const r2 = await pipelineRelockWrites({ project_dir: proj.dir });
      expect(r2.marker_existed).toBe(false);
      expect(await readBypassMarker(proj.dir)).toBeNull();
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects TTL above the maximum", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await expect(
        pipelineUnlockWrites({ project_dir: proj.dir, ttl_seconds: UNLOCK_MAX_TTL_SECONDS + 1, reason: "x" }),
      ).rejects.toThrow(/ttl_seconds/);
    } finally {
      await proj.cleanup();
    }
  });
});
