import { describe, it, expect } from "vitest";
import { pickFromCandidates } from "../../src/lib/pick-from-candidates.js";

describe("pickFromCandidates (item 9)", () => {
  it("happy path: returns LLM-picked items filtered to known + capped", async () => {
    const query = async () =>
      JSON.stringify(["agents/references/api-design.md", "agents/references/caching.md"]);
    const out = await pickFromCandidates({
      query,
      task: "API contract refactor with cache invalidation",
      candidates: [
        "agents/references/api-design.md",
        "agents/references/caching.md",
        "agents/references/observability.md",
      ],
      cap: 5,
    });
    expect(out).toEqual([
      "agents/references/api-design.md",
      "agents/references/caching.md",
    ]);
  });

  it("filters hallucinated candidates not in the supplied set", async () => {
    const query = async () =>
      JSON.stringify(["agents/references/api-design.md", "agents/references/HALLUCINATED.md"]);
    const out = await pickFromCandidates({
      query,
      task: "x",
      candidates: ["agents/references/api-design.md"],
      cap: 5,
    });
    expect(out).toEqual(["agents/references/api-design.md"]);
  });

  it("caps the returned list (preserves LLM ordering)", async () => {
    const query = async () => JSON.stringify(["a", "b", "c", "d", "e", "f", "g"]);
    const out = await pickFromCandidates({
      query,
      task: "x",
      candidates: ["a", "b", "c", "d", "e", "f", "g"],
      cap: 3,
    });
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("undefined query → returns []", async () => {
    const out = await pickFromCandidates({
      query: undefined,
      task: "x",
      candidates: ["a", "b"],
      cap: 5,
    });
    expect(out).toEqual([]);
  });

  it("query throws → returns []", async () => {
    const query = async () => {
      throw new Error("LLM timeout");
    };
    const out = await pickFromCandidates({
      query,
      task: "x",
      candidates: ["a"],
      cap: 5,
    });
    expect(out).toEqual([]);
  });

  it("malformed JSON → returns []", async () => {
    const query = async () => "not json at all";
    const out = await pickFromCandidates({
      query,
      task: "x",
      candidates: ["a"],
      cap: 5,
    });
    expect(out).toEqual([]);
  });

  it("strips markdown code fences before parsing (defensive)", async () => {
    const query = async () => '```json\n["a", "b"]\n```';
    const out = await pickFromCandidates({
      query,
      task: "x",
      candidates: ["a", "b", "c"],
      cap: 5,
    });
    expect(out).toEqual(["a", "b"]);
  });

  it("empty candidates → returns []", async () => {
    const query = async () => "[]";
    const out = await pickFromCandidates({
      query,
      task: "x",
      candidates: [],
      cap: 5,
    });
    expect(out).toEqual([]);
  });

  it("non-string entries in LLM response are dropped (type-safety)", async () => {
    const query = async () => JSON.stringify(["a", 42, null, "b"]);
    const out = await pickFromCandidates({
      query,
      task: "x",
      candidates: ["a", "b"],
      cap: 5,
    });
    expect(out).toEqual(["a", "b"]);
  });
});
