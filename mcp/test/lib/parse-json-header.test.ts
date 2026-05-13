import { describe, it, expect } from "vitest";
import { extractJsonHeader, makeFindingId } from "../../src/lib/parse-json-header.js";

describe("extractJsonHeader — 3-stage parse", () => {
  it("stage 1: extracts a valid fenced ```json block", () => {
    const text = "```json\n{\"agent\":\"x\"}\n```\n\nbody";
    const r = extractJsonHeader(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.agent).toBe("x");
      expect(r.repaired).toBe(false);
    }
  });

  it("stage 2: lenient recovery when fence is missing", () => {
    const text = "# Logic review\n\n{\"agent\":\"logic-reviewer\",\"verdict\":\"APPROVE\"}\n\nrest of narrative";
    const r = extractJsonHeader(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.agent).toBe("logic-reviewer");
      expect(r.repaired).toBe(true);
    }
  });

  it("stage 2: lenient handles nested braces and string-escaped braces", () => {
    const text = `Pre-amble.\n\n{"agent":"x","details":{"foo":"bar {}","nested":{"y":1}}}\nend`;
    const r = extractJsonHeader(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.details.nested.y).toBe(1);
      expect(r.repaired).toBe(true);
    }
  });

  it("stage 2: lenient also fires when fenced block is present but invalid JSON", () => {
    const text = '```json\n{ broken json no quotes }\n```\n\nbut here is a valid {"agent":"x"} object';
    const r = extractJsonHeader(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.agent).toBe("x");
      expect(r.repaired).toBe(true);
    }
  });

  it("stage 3: throws when no fence and no balanced object in head", () => {
    const r = extractJsonHeader("# just markdown\nno braces here");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no fenced/);
  });

  it("stage 3: throws when object starts past the 500-char head", () => {
    const padding = "x".repeat(600);
    const r = extractJsonHeader(`${padding}\n{"agent":"x"}`);
    expect(r.ok).toBe(false);
  });

  it("stage 1 wins over stage 2 (fenced block takes precedence)", () => {
    const text = '```json\n{"agent":"fenced"}\n```\n\nLater: {"agent":"loose"}';
    const r = extractJsonHeader(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.agent).toBe("fenced");
      expect(r.repaired).toBe(false);
    }
  });
});

describe("makeFindingId", () => {
  it("matches the f-YYYY-MM-DD-<slug> format", () => {
    const id = makeFindingId(new Date("2026-05-13T00:00:00Z"));
    expect(id).toMatch(/^f-2026-05-13-[a-z0-9]{6}$/);
  });
});
