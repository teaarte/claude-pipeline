// Shared state-machine helpers used by set-phase-status, record-agent-run,
// and record-nonreview-agent. Single source of truth for phase ordering
// and allowed status transitions.

export const PHASES = [
  "context",
  "planning",
  "test_first",
  "implementation",
  "validation",
  "final",
] as const;
export type Phase = (typeof PHASES)[number];

export const STATUSES = ["pending", "in_progress", "completed", "skipped"] as const;
export type Status = (typeof STATUSES)[number];

// Each phase requires its prereq to be completed OR skipped before it can
// move beyond `pending`. `context` and `final` are roots/exit and have no
// prereq.
export const PHASE_PREREQ: Record<Phase, Phase | null> = {
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
  phase: Phase,
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
  phase: Phase,
  targetStatus: Status,
): void {
  // Only meaningful when moving beyond `pending`.
  if (targetStatus === "pending") return;
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
