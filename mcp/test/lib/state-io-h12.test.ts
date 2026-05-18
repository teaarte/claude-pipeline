/**
 * H12 — withStateLock must not silently coerce pre-existing partial state
 * to null. Either pass it through (so the callback can decide) or throw
 * CORRUPT_STATE. Both prevent the "callback skips mutation, lock release
 * writes nothing, caller thinks success" failure mode.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStateLock } from "../../src/lib/state-io.js";

async function tempFile(initial?: string): Promise<{ file: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "cp-h12-"));
  const file = join(dir, "state.json");
  if (initial !== undefined) {
    await writeFile(file, initial, "utf8");
  }
  return { file, cleanup: async () => await rm(dir, { recursive: true, force: true }) };
}

describe("H12 — withStateLock corruption detection", () => {
  it("throws CORRUPT_STATE when file pre-exists with {}", async () => {
    const { file, cleanup } = await tempFile("{}");
    try {
      await expect(
        withStateLock(file, async () => ({ result: undefined })),
      ).rejects.toThrow(/CORRUPT_STATE/);
    } finally {
      await cleanup();
    }
  });

  it("throws CORRUPT_STATE when file has partial state (missing task_id)", async () => {
    const { file, cleanup } = await tempFile(JSON.stringify({ schema_version: "1.0" }));
    try {
      await expect(
        withStateLock(file, async () => ({ result: undefined })),
      ).rejects.toThrow(/CORRUPT_STATE/);
    } finally {
      await cleanup();
    }
  });

  it("passes valid state through to the callback", async () => {
    const { file, cleanup } = await tempFile(
      JSON.stringify({ schema_version: "1.0", task_id: "t-2026-05-19-stateio", phases: {} }),
    );
    try {
      let seen: any = null;
      await withStateLock(file, async (state) => {
        seen = state;
        return { result: undefined };
      });
      expect(seen?.task_id).toBe("t-2026-05-19-stateio");
    } finally {
      await cleanup();
    }
  });

  it("gives null to the callback when file did not pre-exist (fresh init path)", async () => {
    const { file, cleanup } = await tempFile(); // no initial content
    try {
      let seen: any = "untouched";
      await withStateLock(file, async (state) => {
        seen = state;
        return { result: undefined };
      });
      expect(seen).toBeNull();
    } finally {
      await cleanup();
    }
  });
});
