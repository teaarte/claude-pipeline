import { describe, it, expect } from "vitest";
import { extractJsonHeader, makeFindingId } from "../../src/lib/parse-json-header.js";

describe("extractJsonHeader", () => {
  it("extracts a valid fenced ```json block", () => {
    const text = "```json\n{\"agent\":\"x\"}\n```\n\nbody";
    const r = extractJsonHeader(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.agent).toBe("x");
  });

  it("rejects missing fence", () => {
    const r = extractJsonHeader("# just markdown\nno fence here");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no fenced/);
  });

  it("rejects invalid JSON inside the fence", () => {
    const r = extractJsonHeader("```json\n{not json}\n```");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/parse error/);
  });
});

describe("makeFindingId", () => {
  it("matches the f-YYYY-MM-DD-<slug> format", () => {
    const id = makeFindingId(new Date("2026-05-13T00:00:00Z"));
    expect(id).toMatch(/^f-2026-05-13-[a-z0-9]{6}$/);
  });
});
