/**
 * All built-in AgentPlugins. Each wraps an existing `agents/*.md` prompt
 * template. The driver core never references these names; they're
 * registered in `loaders/builtins.ts` and looked up by name from
 * StepPlugins.
 */

import type { AgentPlugin } from "../../../types/plugin.js";

const PLANNER: AgentPlugin = {
  name: "planner",
  template_path: "agents/planner.md",
  output_schema: "nonreview",
  default_model: "opus",
};

const IMPLEMENTER: AgentPlugin = {
  name: "implementer",
  template_path: "agents/implementer.md",
  output_schema: "nonreview",
  default_model: "opus",
};

const ARCHITECT: AgentPlugin = {
  name: "architect",
  template_path: "agents/architect.md",
  output_schema: "nonreview",
  default_model: "opus",
};

const CODE_ANALYZER: AgentPlugin = {
  name: "code-analyzer",
  template_path: "agents/code-analyzer.md",
  output_schema: "nonreview",
  default_model: "sonnet",
};

const DEPENDENCY_AUDITOR: AgentPlugin = {
  name: "dependency-auditor",
  template_path: "agents/dependency-auditor.md",
  output_schema: "nonreview",
  default_model: "haiku",
};

const RESEARCH: AgentPlugin = {
  name: "research",
  template_path: "agents/research.md",
  output_schema: "nonreview",
  default_model: "opus",
};

const MIGRATION: AgentPlugin = {
  name: "migration",
  template_path: "agents/migration.md",
  output_schema: "nonreview",
  default_model: "opus",
};

const LOGIC_REVIEWER: AgentPlugin = {
  name: "logic-reviewer",
  template_path: "agents/logic-reviewer.md",
  output_schema: "reviewer",
  default_model: "opus",
};

const CHALLENGER_REVIEWER: AgentPlugin = {
  name: "challenger-reviewer",
  template_path: "agents/challenger-reviewer.md",
  output_schema: "reviewer",
  default_model: "opus",
};

const STYLE_REVIEWER: AgentPlugin = {
  name: "style-reviewer",
  template_path: "agents/style-reviewer.md",
  output_schema: "reviewer",
  default_model: "haiku",
};

const SECURITY: AgentPlugin = {
  name: "security",
  template_path: "agents/security.md",
  output_schema: "reviewer",
  default_model: "sonnet",
  applies_to: (state) => {
    const v = state.decisions["security_needed"];
    return v !== false; // default-on unless explicitly disabled
  },
};

const PERFORMANCE: AgentPlugin = {
  name: "performance",
  template_path: "agents/performance.md",
  output_schema: "reviewer",
  default_model: "sonnet",
};

const TEST_AGENT: AgentPlugin = {
  name: "test",
  template_path: "agents/test.md",
  output_schema: "validator",
  default_model: "haiku",
};

const ACCEPTANCE: AgentPlugin = {
  name: "acceptance",
  template_path: "agents/acceptance.md",
  output_schema: "validator",
  default_model: "haiku",
};

const PLAN_CONFORMANCE: AgentPlugin = {
  name: "plan-conformance",
  template_path: "agents/plan-conformance.md",
  output_schema: "validator",
  default_model: "haiku",
};

const PLAN_GROUNDING_CHECK: AgentPlugin = {
  name: "plan-grounding-check",
  template_path: "agents/plan-grounding-check.md",
  output_schema: "validator",
  default_model: "haiku",
};

const CONTEXT_DOC_VERIFIER: AgentPlugin = {
  name: "context-doc-verifier",
  template_path: "agents/context-doc-verifier.md",
  output_schema: "validator",
  default_model: "haiku",
};

const UI_CONSISTENCY: AgentPlugin = {
  name: "ui-consistency",
  template_path: "agents/ui-consistency.md",
  output_schema: "validator",
  default_model: "haiku",
  applies_to: (state) => state.decisions["ui_touched"] === true,
};

const API_CONTRACT: AgentPlugin = {
  name: "api-contract",
  template_path: "agents/api-contract.md",
  output_schema: "validator",
  default_model: "haiku",
  applies_to: (state) => state.decisions["api_touched"] === true,
};

const PLAYWRIGHT: AgentPlugin = {
  name: "playwright",
  template_path: "agents/playwright.md",
  output_schema: "validator",
  default_model: "haiku",
  applies_to: (state) => state.decisions["ui_touched"] === true,
};

const CLASSIFIER: AgentPlugin = {
  name: "classifier",
  template_path: "agents/classifier.md",
  output_schema: "nonreview",
  default_model: "haiku",
};

export const BUILTIN_AGENTS: AgentPlugin[] = [
  CLASSIFIER,
  PLANNER,
  IMPLEMENTER,
  ARCHITECT,
  CODE_ANALYZER,
  DEPENDENCY_AUDITOR,
  RESEARCH,
  MIGRATION,
  LOGIC_REVIEWER,
  CHALLENGER_REVIEWER,
  STYLE_REVIEWER,
  SECURITY,
  PERFORMANCE,
  TEST_AGENT,
  ACCEPTANCE,
  PLAN_CONFORMANCE,
  PLAN_GROUNDING_CHECK,
  CONTEXT_DOC_VERIFIER,
  UI_CONSISTENCY,
  API_CONTRACT,
  PLAYWRIGHT,
];
