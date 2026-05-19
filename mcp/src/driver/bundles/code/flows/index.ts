import type { FlowPlugin } from "../../../types/plugin.js";
import { CODE_PHASES } from "../../../../lib/phase-state-machine.js";

const CODE_FLOW_PHASES: string[] = [...CODE_PHASES];

const SIMPLE_FLOW: FlowPlugin = {
  name: "simple",
  complexity: "simple",
  phases: CODE_FLOW_PHASES,
  steps: [
    "initialize",
    "classify",
    "classify-agent",
    "plan",
    "plan-grounding",
    "gate-1",
    "git-stash",
    "implement",
    "git-diff",
    "pre-review",
    "review",
    "final-checks",
    "test-verify",
    "gate-2",
    "finalize",
  ],
};

const MEDIUM_FLOW: FlowPlugin = {
  name: "medium",
  complexity: "medium",
  phases: CODE_FLOW_PHASES,
  steps: [
    "initialize",
    "classify",
    "classify-agent",
    "gate-0",
    "enrich",
    "context-verify",
    "plan",
    "plan-grounding",
    "plan-review",
    "gate-1",
    "test-first",
    "git-stash",
    "implement",
    "git-diff",
    "pre-review",
    "review",
    "reconcile",
    "iterate",
    "sacred-tests",
    "final-checks",
    "test-verify",
    "gate-2",
    "finalize",
  ],
};

const COMPLEX_FLOW: FlowPlugin = {
  name: "complex",
  complexity: "complex",
  phases: CODE_FLOW_PHASES,
  steps: [
    "initialize",
    "classify",
    "classify-agent",
    "gate-0",
    "enrich",
    "context-verify",
    "architect",
    "plan",
    "plan-grounding",
    "plan-review",
    "gate-1",
    "test-first",
    "git-stash",
    "implement",
    "git-diff",
    "pre-review",
    "review",
    "reconcile",
    "iterate",
    "sacred-tests",
    "final-checks",
    "test-verify",
    "gate-2",
    "finalize",
  ],
};

export const BUILTIN_FLOWS: FlowPlugin[] = [SIMPLE_FLOW, MEDIUM_FLOW, COMPLEX_FLOW];
