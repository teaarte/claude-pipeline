import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TASK_ID_PATTERN,
  sanitizeTaskIdSlug,
  makeTaskId,
  makeUniqueTaskId,
} from "../../src/lib/ids.js";
import { pipelineJsonl } from "../../src/lib/paths.js";
import { clearMetrics } from "../helpers/setup.js";

// Q42: TASK_ID_PATTERN now accepts an optional -[a-f0-9]{4} collision suffix.
// The base shape (no suffix) is still valid; tests below cover both branches.
const SCHEMA_RE = /^t-\d{4}-\d{2}-\d{2}-[a-z0-9]{4,}(?:-[a-f0-9]{4})?$/;

describe("sanitizeTaskIdSlug", () => {
  it("strips spaces and lowercases", () => {
    expect(sanitizeTaskIdSlug("rename foo to bar")).toBe("renamefootobar");
  });

  it("truncates to 20 chars and drops punctuation/parentheses", () => {
    const out = sanitizeTaskIdSlug("feat: Add user-settings page (Phase 0.5)");
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).toMatch(/^[a-z0-9]+$/);
    // First chars should reflect the source — collapse of non-alphanumeric
    // means "feataddusersettings…" with no hyphens.
    expect(out.startsWith("featadduserse")).toBe(true);
  });

  it("returns a schema-valid random hex when the input has no [a-z0-9] chars", () => {
    const out = sanitizeTaskIdSlug("кириллица в названии");
    expect(out).toMatch(/^[a-z0-9]+$/);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.length).toBeLessThanOrEqual(20);
  });

  it("pads empty input to a schema-valid random hex", () => {
    const out = sanitizeTaskIdSlug("");
    expect(out).toMatch(/^[a-z0-9]+$/);
    expect(out.length).toBeGreaterThanOrEqual(4);
  });

  it("pads single-character input to length ≥ 4", () => {
    const out = sanitizeTaskIdSlug("a");
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out).toMatch(/^a[a-f0-9]+/);
  });

  it("returns a schema-valid random hex for all-non-alphanumeric input", () => {
    const out = sanitizeTaskIdSlug("--- ??? !!!");
    expect(out).toMatch(/^[a-z0-9]+$/);
    expect(out.length).toBeGreaterThanOrEqual(4);
  });
});

describe("makeTaskId", () => {
  it("derives a schema-valid task_id from a normal task description", () => {
    const id = makeTaskId({ task: "rename foo to bar", date: new Date("2026-05-14T00:00:00Z") });
    expect(id).toBe("t-2026-05-14-renamefootobar");
    expect(id).toMatch(SCHEMA_RE);
    expect(id).toMatch(TASK_ID_PATTERN);
  });

  it("derives a schema-valid task_id for the original gateway-orval-tanstaack regression case (Q7 source)", () => {
    const id = makeTaskId({
      task: "gateway ui gateway orval tanstaack query",
      date: new Date("2026-05-13T00:00:00Z"),
    });
    expect(id).toMatch(SCHEMA_RE);
    // Specifically: no hyphens after the date prefix.
    const slug = id.slice("t-YYYY-MM-DD-".length);
    expect(slug).not.toMatch(/-/);
  });

  it.each([
    "rename foo to bar",
    "feat: Add user-settings page (Phase 0.5)",
    "кириллица в названии",
    "",
    "a",
    "--- ??? !!!",
    "Multi   Whitespace   here",
    "tabs\t\tand\nnewlines",
  ])("always emits a schema-valid task_id for input %j", (task) => {
    const id = makeTaskId({ task });
    expect(id).toMatch(SCHEMA_RE);
  });

  it("accepts an explicit, valid task_id verbatim", () => {
    const id = makeTaskId({ task: "anything", task_id: "t-2026-05-14-explicitid" });
    expect(id).toBe("t-2026-05-14-explicitid");
  });

  it("rejects an explicit task_id that violates the schema", () => {
    expect(() => makeTaskId({ task: "x", task_id: "t-2026-05-14-bad-slug" })).toThrow(/does not match/);
    expect(() => makeTaskId({ task: "x", task_id: "t-2026-05-14-ab" })).toThrow(/does not match/);
  });

  it("Q42: accepts an explicit task_id carrying a collision suffix", () => {
    const id = makeTaskId({ task: "anything", task_id: "t-2026-05-14-contextreadfirstinth-a3f9" });
    expect(id).toBe("t-2026-05-14-contextreadfirstinth-a3f9");
    expect(id).toMatch(TASK_ID_PATTERN);
  });
});

describe("makeUniqueTaskId (Q42)", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("returns the bare slug when no collision exists in recent metrics", async () => {
    const id = await makeUniqueTaskId({
      task: "rename foo to bar",
      date: new Date("2026-05-14T00:00:00Z"),
    });
    expect(id).toBe("t-2026-05-14-renamefootobar");
    expect(id).toMatch(SCHEMA_RE);
  });

  it("appends an -[a-f0-9]{4} suffix when slug collides with a recent metrics row", async () => {
    const existing = "t-2026-05-14-contextreadfirstinth";
    await writeFile(pipelineJsonl, JSON.stringify({ task_id: existing }) + "\n", "utf8");
    const id = await makeUniqueTaskId({
      task: "## Context (read first, in this order) — different task body",
      date: new Date("2026-05-14T00:00:00Z"),
    });
    expect(id).not.toBe(existing);
    expect(id.startsWith(`${existing}-`)).toBe(true);
    // 4-hex collision suffix.
    expect(id).toMatch(/^t-2026-05-14-contextreadfirstinth-[a-f0-9]{4}$/);
    expect(id).toMatch(TASK_ID_PATTERN);
  });

  it("schema-validates the suffixed id against TASK_ID_PATTERN", async () => {
    const existing = "t-2026-05-14-renamefootobar";
    await writeFile(pipelineJsonl, JSON.stringify({ task_id: existing }) + "\n", "utf8");
    const id = await makeUniqueTaskId({
      task: "rename foo to bar",
      date: new Date("2026-05-14T00:00:00Z"),
    });
    expect(id).toMatch(TASK_ID_PATTERN);
  });

  it("explicit task_id bypasses collision detection (caller owns uniqueness)", async () => {
    const existing = "t-2026-05-14-explicitid";
    await writeFile(pipelineJsonl, JSON.stringify({ task_id: existing }) + "\n", "utf8");
    const id = await makeUniqueTaskId({
      task: "anything",
      task_id: existing,
    });
    expect(id).toBe(existing);
  });

  it("missing metrics file degrades to no-collision (returns bare slug)", async () => {
    // Use a path that doesn't exist instead of clearing — the readFile catch
    // branch is what we're exercising.
    const id = await makeUniqueTaskId({
      task: "rename foo to bar",
      date: new Date("2026-05-14T00:00:00Z"),
      metricsFile: join(pipelineJsonl, "..", "does-not-exist-xyz.jsonl"),
    });
    expect(id).toBe("t-2026-05-14-renamefootobar");
  });

  it("ignores malformed lines in pipeline.jsonl without crashing", async () => {
    await writeFile(
      pipelineJsonl,
      ["not-json", "{}", JSON.stringify({ task_id: "t-2026-05-14-renamefootobar" })].join("\n") + "\n",
      "utf8",
    );
    const id = await makeUniqueTaskId({
      task: "rename foo to bar",
      date: new Date("2026-05-14T00:00:00Z"),
    });
    expect(id).toMatch(/^t-2026-05-14-renamefootobar-[a-f0-9]{4}$/);
  });
});
