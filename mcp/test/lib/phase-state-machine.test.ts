import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  ALLOWED_TRANSITIONS,
  STATUSES,
  PHASES,
  assertTransitionAllowed,
  assertPrereqSatisfied,
} from "../../src/lib/phase-state-machine.js";

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
});
