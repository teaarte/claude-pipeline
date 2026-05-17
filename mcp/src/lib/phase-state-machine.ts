// Shared state-machine helpers used by set-phase-status, record-agent-run,
// and record-nonreview-agent. Single source of truth for phase ordering
// and allowed status transitions.
//
// v2.2.5 bundle-foundation: Phase is now a runtime-validated string, not a
// hard-coded enum. The code bundle still owns the canonical 6-phase
// progression (exported as CODE_PHASES); future bundles ship their own
// ordered phases via FlowPlugin.phases[]. The driver core and shared tools
// treat Phase opaquely as `string`.

export const CODE_PHASES = [
  "context",
  "planning",
  "test_first",
  "implementation",
  "validation",
  "final",
] as const;

export type Phase = string;

export const STATUSES = ["pending", "in_progress", "completed", "skipped"] as const;
export type Status = (typeof STATUSES)[number];

// Code-bundle phase prerequisite chain. Phases not present in this map are
// treated as having no enforced prereq — the flow's declared `phases[]`
// ordering is the ordering authority for non-code bundles.
//
// `context` and `final` are roots/exit and have no prereq.
export const PHASE_PREREQ: Record<string, string | null> = {
  context: null,
  planning: "context",
  test_first: "planning",
  implementation: "test_first",
  validation: "implementation",
  final: null,
};

// Allowed status transitions. Terminal states (completed/skipped) have no
// outgoing transitions — once a phase is closed it cannot reopen. From
// `pending` we accept jumping straight to `completed` or `skipped` (this
// happens legitimately for `context` when no enrichment agents run, and for
// `test_first` when tests_mode=regression-only). The agent-count and
// prerequisite guards (INV_002 / INV_011) handle the "is this jump legitimate"
// question separately. A phase staying in its current status is always
// permitted (handled outside this map as an equality check).
export const ALLOWED_TRANSITIONS: Record<Status, readonly Status[]> = {
  pending: ["in_progress", "completed", "skipped"],
  in_progress: ["completed", "skipped"],
  completed: [],
  skipped: [],
};

export function assertTransitionAllowed(
  phase: string,
  from: Status,
  to: Status,
): void {
  if (from === to) return;
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `INV_010: invalid status transition for phase '${phase}': '${from}' → '${to}'. ` +
        `Allowed from '${from}': ${JSON.stringify(allowed)}. ` +
        `Pass force=true to override (records pipeline_violation).`,
    );
  }
}

export function assertPrereqSatisfied(
  state: any,
  phase: string,
  targetStatus: Status,
): void {
  // Only meaningful when moving beyond `pending`.
  if (targetStatus === "pending") return;
  // Phases not in the code-bundle chain have no prereq to enforce here —
  // their ordering is governed by FlowPlugin.phases[]. Skip cleanly.
  if (!(phase in PHASE_PREREQ)) return;
  const prereqName = PHASE_PREREQ[phase];
  if (!prereqName) return;
  const prereqStatus: Status =
    (state.phases?.[prereqName]?.status as Status) ?? "pending";
  if (prereqStatus !== "completed" && prereqStatus !== "skipped") {
    throw new Error(
      `INV_011: cannot advance phase '${phase}' to '${targetStatus}' — ` +
        `prereq phase '${prereqName}' is '${prereqStatus}'. ` +
        `Complete or skip the prereq first. Pass force=true to override (records pipeline_violation).`,
    );
  }
}

/**
 * Runtime guard: returns true if `phase` is one of the flow's declared
 * phases. Used by pipeline_validate / FSM-runtime callers that want to
 * catch typos the string-typed Phase no longer rejects at compile time.
 */
export function isValidPhase(
  phase: string,
  flowPhases: readonly string[],
): boolean {
  return flowPhases.includes(phase);
}
