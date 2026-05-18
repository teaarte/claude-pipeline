import { describe, it, expect } from "vitest";
import { validate } from "../../src/lib/schemas.js";

// v2.2.6 C4: classifier-output schema gains `stack` + `change_kind` fields.
// Auto-spawn activation lives in v2.2.7 Item 1 — this commit only ships the
// schema substrate. These tests cover schema acceptance / rejection of the
// new fields and backward compatibility with the 1.0 shape.

const MIN_OUTPUT_1_1 = {
  schema_version: "1.1",
  agent: "classifier",
  task_id: "t-2026-05-18-implementphase07step",
  task_short: "doc-drift-fix",
  refs_to_load: [],
  security_needed: false,
  antipattern_rules_applicable: [],
};

const MIN_OUTPUT_1_0 = {
  schema_version: "1.0",
  agent: "classifier",
  task_id: null,
  task_short: null,
  refs_to_load: [],
  security_needed: false,
  antipattern_rules_applicable: [],
};

describe("classifier-output.schema.json — v2.2.6 stack + change_kind", () => {
  it("accepts the legacy schema_version 1.0 shape (backwards compatible)", async () => {
    const r = await validate("classifier-output.schema.json", MIN_OUTPUT_1_0);
    expect(r.ok).toBe(true);
  });

  it("accepts the schema_version 1.1 shape with stack + change_kind omitted (optional)", async () => {
    const r = await validate("classifier-output.schema.json", MIN_OUTPUT_1_1);
    expect(r.ok).toBe(true);
  });

  it("accepts a fully-populated stack object", async () => {
    const r = await validate("classifier-output.schema.json", {
      ...MIN_OUTPUT_1_1,
      stack: {
        language: "typescript",
        package_manager: "pnpm",
        test_command: "pnpm -r test",
        lint_command: "pnpm -r lint",
        build_command: "pnpm -r build",
        project_type: "frontend-app",
      },
    });
    expect(r.ok).toBe(true);
  });

  it("accepts stack with null package_manager + commands (e.g. unknown ecosystem)", async () => {
    const r = await validate("classifier-output.schema.json", {
      ...MIN_OUTPUT_1_1,
      stack: {
        language: "elixir",
        package_manager: null,
        test_command: null,
        lint_command: null,
        build_command: null,
        project_type: null,
      },
    });
    expect(r.ok).toBe(true);
  });

  it("accepts stack === null (classifier signaling indeterminate stack)", async () => {
    const r = await validate("classifier-output.schema.json", {
      ...MIN_OUTPUT_1_1,
      stack: null,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects stack missing the required `language` field", async () => {
    const r = await validate("classifier-output.schema.json", {
      ...MIN_OUTPUT_1_1,
      stack: { package_manager: "pnpm" },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects stack missing the required `package_manager` field", async () => {
    const r = await validate("classifier-output.schema.json", {
      ...MIN_OUTPUT_1_1,
      stack: { language: "typescript" },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid project_type enum value", async () => {
    const r = await validate("classifier-output.schema.json", {
      ...MIN_OUTPUT_1_1,
      stack: {
        language: "rust",
        package_manager: "cargo",
        project_type: "not-a-real-type",
      },
    });
    expect(r.ok).toBe(false);
  });

  it("accepts change_kind === 'type-only'", async () => {
    const r = await validate("classifier-output.schema.json", {
      ...MIN_OUTPUT_1_1,
      change_kind: "type-only",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts change_kind === null (genuinely indeterminate)", async () => {
    const r = await validate("classifier-output.schema.json", {
      ...MIN_OUTPUT_1_1,
      change_kind: null,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects an invalid change_kind enum value", async () => {
    const r = await validate("classifier-output.schema.json", {
      ...MIN_OUTPUT_1_1,
      change_kind: "refactor-only",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects schema_version other than '1.0' or '1.1'", async () => {
    const r = await validate("classifier-output.schema.json", {
      ...MIN_OUTPUT_1_1,
      schema_version: "0.9",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown top-level fields (additionalProperties: false)", async () => {
    const r = await validate("classifier-output.schema.json", {
      ...MIN_OUTPUT_1_1,
      unknown_field: "x",
    });
    expect(r.ok).toBe(false);
  });
});
