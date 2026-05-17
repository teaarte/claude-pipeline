import { describe, it, expect } from "vitest";
import { validate, validatePipelineState } from "../../src/lib/schemas.js";

// Item 2: schema split into base (universal) + bundle extensions
// (per-bundle required fields). The base accepts schema_version "1.0" or
// "1.1"; old `1.0` files without a `bundle` field are treated as code
// bundle for backward-compat. The code extension requires `tests_mode`
// and `stack`; other bundles (synthetic, future) do not.

const baseRequiredState = {
  schema_version: "1.1",
  bundle: "code",
  task_id: "t-2026-05-18-itemtwo",
  task: "schema split test",
  complexity: "simple",
  tests_mode: "regression-only",
  stack: { language: "typescript" },
  started_at: "2026-05-18T00:00:00Z",
  phases: {},
  gates: {},
  agents_count: 0,
};

describe("schema split (item 2)", () => {
  it("base schema accepts schema_version 1.1 + bundle='code'", async () => {
    const r = await validate("pipeline-state.schema.json", baseRequiredState);
    expect(r.ok).toBe(true);
  });

  it("backward-compat: state without bundle field validates (defaults to code via extension)", async () => {
    const { bundle: _b, ...legacy } = baseRequiredState;
    const r = await validatePipelineState({ ...legacy, schema_version: "1.0" });
    expect(r.ok).toBe(true);
  });

  it("code bundle: missing tests_mode → extension reports failure", async () => {
    const { tests_mode: _t, ...partial } = baseRequiredState;
    const r = await validatePipelineState(partial);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const msgs = r.errors.map((e) => e.message).join("\n");
      expect(msgs).toContain("[code-extension]");
    }
  });

  it("synthetic bundle: extension absent → base-only validation passes (no tests_mode required)", async () => {
    const { tests_mode: _t, stack: _s, ...partial } = baseRequiredState;
    const r = await validatePipelineState({ ...partial, bundle: "tiktok" });
    expect(r.ok).toBe(true);
  });

  it("base rejects unknown schema_version values", async () => {
    const r = await validate("pipeline-state.schema.json", {
      ...baseRequiredState,
      schema_version: "9.9",
    });
    expect(r.ok).toBe(false);
  });
});
