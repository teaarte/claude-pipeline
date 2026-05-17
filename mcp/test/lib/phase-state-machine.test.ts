import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  ALLOWED_TRANSITIONS,
  STATUSES,
  PHASES,
  CODE_PHASES,
  assertTransitionAllowed,
  assertPrereqSatisfied,
  isValidPhase,
} from "../../src/lib/phase-state-machine.js";
import { validate } from "../../src/lib/schemas.js";

describe("phase-state-machine", () => {
  it("rejects every transition not in the allow table", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PHASES),
        fc.constantFrom(...STATUSES),
        fc.constantFrom(...STATUSES),
        (phase, from, to) => {
          if (from === to) return;
          const allowed = ALLOWED_TRANSITIONS[from] ?? [];
          if (allowed.includes(to)) {
            expect(() => assertTransitionAllowed(phase, from, to)).not.toThrow();
          } else {
            expect(() => assertTransitionAllowed(phase, from, to)).toThrow(/INV_010/);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("INV_011: refuses to advance when prereq is pending/in_progress", () => {
    const state = {
      phases: {
        context: { status: "pending" },
        planning: { status: "pending" },
        test_first: { status: "pending" },
        implementation: { status: "pending" },
        validation: { status: "pending" },
        final: { status: "pending" },
      },
    };
    expect(() => assertPrereqSatisfied(state, "implementation", "in_progress")).toThrow(/INV_011/);
  });

  it("INV_011: permits advance once prereq is completed", () => {
    const state = {
      phases: {
        context: { status: "completed" },
        planning: { status: "completed" },
        test_first: { status: "skipped" },
        implementation: { status: "pending" },
      },
    };
    expect(() => assertPrereqSatisfied(state, "implementation", "in_progress")).not.toThrow();
  });

  it("context and final have no prereq", () => {
    const empty: any = { phases: {} };
    expect(() => assertPrereqSatisfied(empty, "context", "completed")).not.toThrow();
    expect(() => assertPrereqSatisfied(empty, "final", "completed")).not.toThrow();
  });

  it("PHASES is an alias for CODE_PHASES (backward-compat)", () => {
    expect([...PHASES]).toEqual([...CODE_PHASES]);
  });

  it("isValidPhase: phase in flow.phases → true; otherwise → false", () => {
    const flowPhases = ["alpha", "beta", "gamma"];
    expect(isValidPhase("alpha", flowPhases)).toBe(true);
    expect(isValidPhase("delta", flowPhases)).toBe(false);
    // Empty flow has no valid phases.
    expect(isValidPhase("anything", [])).toBe(false);
  });

  it("assertPrereqSatisfied: phase not in code-bundle chain → no-op (no throw)", () => {
    // Synthetic phase names from a future non-code bundle: prereq enforcement
    // is the flow's job; the helper must not crash on unknown phases.
    const state: any = { phases: { draft: { status: "pending" } } };
    expect(() => assertPrereqSatisfied(state, "render", "in_progress")).not.toThrow();
    expect(() => assertPrereqSatisfied(state, "publish", "completed")).not.toThrow();
  });

  it("schema accepts custom phase keys + reviewer_verdicts phase strings (additionalProperties: true)", async () => {
    const baseState = {
      schema_version: "1.0",
      task_id: "t-2026-05-18-bundletest",
      task: "synthetic test",
      complexity: "simple",
      tests_mode: "regression-only",
      stack: { language: "typescript" },
      started_at: "2026-05-18T00:00:00Z",
      phases: {
        // Code-bundle keys present and valid:
        context: { status: "completed" },
        // Synthetic custom phase from a hypothetical future bundle — must
        // validate clean now that additionalProperties:true on phases and
        // the reviewer_verdicts.phase enum was removed.
        alpha: { status: "completed" },
        beta: { status: "in_progress" },
      },
      gates: {},
      agents_count: 1,
      reviewer_verdicts: [
        { agent: "draft-agent", phase: "alpha", iteration: 1, verdict: "ok" },
      ],
    };

    const result = await validate("pipeline-state.schema.json", baseState);
    expect(result.ok).toBe(true);
  });
});
