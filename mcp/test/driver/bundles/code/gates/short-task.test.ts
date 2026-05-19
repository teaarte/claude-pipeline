/**
 * Q71 / D10 regression: gate-0 and gate-1 message bodies truncate the task
 * description via shortTask(state). Real-task observation 2026-05-19: the
 * full 10 KB task description appeared inline in gate prompts, forcing the
 * human to scroll past their own input to find the Reply prompt. shortTask
 * picks state.decisions.task_short (populated by classifier — D1 future)
 * when present, falls back to the first non-empty line trimmed at 80 chars.
 *
 * Gate-2 message is constant — not touched by this fix.
 */

import { describe, it, expect } from "vitest";
import { shortTask } from "../../../../../src/driver/bundles/code/gates/index.js";
import { createRegistry } from "../../../../../src/driver/core/registry.js";
import { loadBundle } from "../../../../../src/driver/loaders/bundles.js";
import { makeInitialDriverState } from "../../../../../src/driver/core/state.js";
import { requireGate } from "../../../../../src/driver/core/registry.js";
import type { DriverState } from "../../../../../src/driver/types/plugin.js";

function makeState(task: string, decisions: Record<string, unknown> = {}): DriverState {
  const s = makeInitialDriverState({
    project_dir: "/tmp/q71",
    task,
    flow_name: "medium",
  });
  Object.assign(s.decisions, decisions);
  return s;
}

describe("Q71 / D10 — shortTask helper", () => {
  it("prefers state.decisions.task_short when populated", () => {
    const s = makeState("very long task body...", { task_short: "fix-cache-bug" });
    expect(shortTask(s)).toBe("fix-cache-bug");
  });

  it("trims whitespace around task_short", () => {
    const s = makeState("anything", { task_short: "  refactor-auth  " });
    expect(shortTask(s)).toBe("refactor-auth");
  });

  it("falls back to the first non-empty line of state.task when task_short is null/missing", () => {
    const s = makeState("Add a feature flag\n\nDetailed body line 1.\nLine 2.");
    expect(shortTask(s)).toBe("Add a feature flag");
  });

  it("truncates a long first line to 80 chars with an ellipsis", () => {
    const longLine = "x".repeat(120);
    const s = makeState(longLine);
    const out = shortTask(s);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("...")).toBe(true);
  });

  it("returns the line untouched when the first line is exactly 80 chars", () => {
    const line = "y".repeat(80);
    const s = makeState(line);
    expect(shortTask(s)).toBe(line);
  });

  it("skips leading blank lines to find the first content line", () => {
    const s = makeState("\n\n  \nFirst real content\nSecond line");
    expect(shortTask(s)).toBe("First real content");
  });

  it("returns a safe placeholder when state.task is empty", () => {
    const s = makeState("");
    expect(shortTask(s)).toBe("(empty task)");
  });
});

describe("Q71 / D10 — gate message snapshot", () => {
  it("gate-0 message stays compact even with a 10 KB task body", async () => {
    const registry = createRegistry();
    await loadBundle("code", registry);
    const huge = "Add a feature flag\n\n" + "x".repeat(10_000);
    const state = makeState(huge, { complexity: "medium" });
    const gate = requireGate(registry, "gate-0");
    const msg = await Promise.resolve(gate.message(state));
    expect(msg.length).toBeLessThan(500);
    expect(msg).toContain("Add a feature flag");
    expect(msg).toContain("Reply 1/accept or 2/reject");
    // The huge body MUST NOT leak into the gate prompt.
    expect(msg).not.toContain("x".repeat(200));
  });

  it("gate-1 message stays compact even with a 10 KB task body", async () => {
    const registry = createRegistry();
    await loadBundle("code", registry);
    const huge = "Refactor the cache layer\n\n" + "y".repeat(10_000);
    const state = makeState(huge);
    const gate = requireGate(registry, "gate-1");
    const msg = await Promise.resolve(gate.message(state));
    expect(msg.length).toBeLessThan(500);
    expect(msg).toContain("Refactor the cache layer");
    expect(msg).not.toContain("y".repeat(200));
  });
});
