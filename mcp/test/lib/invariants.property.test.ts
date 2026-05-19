import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInvariants } from "../../src/lib/invariants.js";
import { clearMetrics, tempProject, initArgs, reviewerOutput, validatorOutput, spawnNonreview, spawnReviewer } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineBeginAgent } from "../../src/tools/begin-agent.js";
import { pipelineSetGate } from "../../src/tools/set-gate.js";

function baseState(): any {
  return {
    schema_version: "1.0",
    task_id: "t-2026-05-13-test",
    task: "x",
    complexity: "medium",
    tests_mode: "regression-only",
    stack: { language: "TypeScript" },
    started_at: "2026-05-13T00:00:00.000Z",
    refs_loaded: [],
    refs_dropped_due_to_cap: [],
    phases: {
      context: { status: "pending", agents: [], open_spawns: [] },
      planning: { status: "pending", gate1_revisions: 0, grounding_mismatches: 0, agents: [], open_spawns: [] },
      test_first: { status: "pending", skipped_reason: null, test_spec_count_in_plan: null, tests_written_count: null, test_files_written: [], test_files_hashes_post_red: {}, agents: [], open_spawns: [] },
      implementation: { status: "pending", antipattern_candidates_count: 0, caller_context_sites_count: 0, logic_vs_challenger_disagreement: false, plan_conformance: null, drift_files_count: 0, test_files_modified_by_implementer: [], checkpoint_results: [], agents: [], open_spawns: [] },
      validation: { status: "pending", agents: [], open_spawns: [] },
      final: { status: "pending", agents: [], open_spawns: [] },
    },
    reviewer_verdicts: [],
    findings_path: ".claude/findings.jsonl",
    files: { created: [], modified: [] },
    gates: { gate0: "pending", gate1: "pending", gate2: "pending", gate1_feedback: null, gate2_feedback: null },
    agents_count: 0,
    tests_written: null,
    blockers_found: 0,
    verdict: null,
    pipeline_violation: null,
  };
}

let emptyFindings: string;
let cleanups: Array<() => Promise<void>> = [];

async function freshFindings(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cp-inv-"));
  const f = join(dir, "findings.jsonl");
  await writeFile(f, "", "utf8");
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return f;
}

describe("invariants property + targeted tests", () => {
  afterEach(async () => {
    await clearMetrics();
    for (const c of cleanups) await c();
    cleanups = [];
  });

  it("INV_001: medium/complex + completed phase + zero agents → violation", async () => {
    const s = baseState();
    s.complexity = "medium";
    s.phases.context.status = "completed";
    s.agents_count = 0;
    emptyFindings = await freshFindings();
    const v = await runInvariants(s, emptyFindings);
    expect(v.map((x) => x.code)).toContain("INV_001");
  });

  it("INV_001: simple does not trigger", async () => {
    const s = baseState();
    s.complexity = "simple";
    s.phases.context.status = "completed";
    s.agents_count = 0;
    emptyFindings = await freshFindings();
    const v = await runInvariants(s, emptyFindings);
    expect(v.map((x) => x.code)).not.toContain("INV_001");
  });

  it("INV_002: completed phase 'planning' with no agents → violation", async () => {
    const s = baseState();
    s.phases.planning.status = "completed";
    s.phases.planning.agents = [];
    s.agents_count = 0;
    emptyFindings = await freshFindings();
    const v = await runInvariants(s, emptyFindings);
    expect(v.map((x) => x.code)).toContain("INV_002");
  });

  it("INV_003: skipped 'test_first' without skipped_reason → violation", async () => {
    const s = baseState();
    s.phases.test_first.status = "skipped";
    s.phases.test_first.skipped_reason = null;
    emptyFindings = await freshFindings();
    const v = await runInvariants(s, emptyFindings);
    expect(v.map((x) => x.code)).toContain("INV_003");
  });

  it("INV_004: reviewer_verdicts.length > agents_count → violation", async () => {
    const s = baseState();
    s.agents_count = 1;
    s.reviewer_verdicts = [
      { agent: "a", iteration: 1, verdict: "APPROVE" },
      { agent: "b", iteration: 1, verdict: "APPROVE" },
    ];
    emptyFindings = await freshFindings();
    const v = await runInvariants(s, emptyFindings);
    expect(v.map((x) => x.code)).toContain("INV_004");
  });

  it("INV_005: gate1=approved with planning still pending → violation", async () => {
    const s = baseState();
    s.gates.gate1 = "approved";
    emptyFindings = await freshFindings();
    const v = await runInvariants(s, emptyFindings);
    expect(v.map((x) => x.code)).toContain("INV_005");
  });

  it("INV_006: gate2=approved with implementation pending → violation", async () => {
    const s = baseState();
    s.gates.gate2 = "approved";
    emptyFindings = await freshFindings();
    const v = await runInvariants(s, emptyFindings);
    expect(v.map((x) => x.code)).toContain("INV_006");
  });

  it("INV_007: verdict set but phases not all complete → violation", async () => {
    const s = baseState();
    s.verdict = "accepted";
    emptyFindings = await freshFindings();
    const v = await runInvariants(s, emptyFindings);
    expect(v.map((x) => x.code)).toContain("INV_007");
  });

  it("INV_008: a findings.jsonl line failing schema → violation", async () => {
    const s = baseState();
    const dir = await mkdtemp(join(tmpdir(), "cp-inv-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const f = join(dir, "findings.jsonl");
    await writeFile(f, JSON.stringify({ bogus: true }) + "\n", "utf8");
    const v = await runInvariants(s, f);
    expect(v.map((x) => x.code)).toContain("INV_008");
  });

  it("INV_009: implementer-modified test file with no human approval → violation", async () => {
    const s = baseState();
    s.phases.implementation.test_files_modified_by_implementer = ["src/foo.test.ts"];
    emptyFindings = await freshFindings();
    const v = await runInvariants(s, emptyFindings);
    expect(v.map((x) => x.code)).toContain("INV_009");
  });

  it("INV_009: implementer-modified test file with human approval at gate2 → no violation", async () => {
    const s = baseState();
    s.phases.implementation.test_files_modified_by_implementer = ["src/foo.test.ts"];
    s.gates.gate2 = "approved";
    s.gates.gate2_feedback = "approves sacred-test modification: src/foo.test.ts";
    // Also need impl/validation completed for gate2 invariants not to add noise
    s.phases.implementation.status = "completed";
    s.phases.implementation.agents = ["implementer"];
    s.phases.validation.status = "completed";
    s.phases.validation.agents = ["acceptance"];
    emptyFindings = await freshFindings();
    const v = await runInvariants(s, emptyFindings);
    expect(v.map((x) => x.code)).not.toContain("INV_009");
  });

  it("INV_010 (throw): invalid status transition completed → in_progress", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await expect(
        pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "in_progress" }),
      ).rejects.toThrow(/INV_010/);
    } finally {
      await proj.cleanup();
    }
  });

  it("INV_011 (throw): cannot begin agent in implementation when test_first pending", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await expect(
        pipelineBeginAgent({ project_dir: proj.dir, phase: "implementation", agent: "implementer" }),
      ).rejects.toThrow(/INV_011/);
    } finally {
      await proj.cleanup();
    }
  });

  it("INV_012: completed phase with non-empty open_spawns → violation", async () => {
    const s = baseState();
    s.phases.implementation.status = "completed";
    s.phases.implementation.agents = ["implementer"];
    s.phases.implementation.open_spawns = [
      { id: "ar-aaaa-bbbb-cccc-dddd-eeeeeeeeeeee", agent: "logic-reviewer", model: null, started_at: new Date().toISOString() },
    ];
    emptyFindings = await freshFindings();
    const v = await runInvariants(s, emptyFindings);
    expect(v.map((x) => x.code)).toContain("INV_012");
  });

  it("stale-spawn: open_spawn older than threshold → violation", async () => {
    const s = baseState();
    s.phases.planning.status = "in_progress";
    s.phases.planning.agents = ["planner"];
    s.phases.planning.open_spawns = [
      {
        id: "ar-stale-0000-0000-0000-000000000000",
        agent: "planner",
        model: null,
        started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
      },
    ];
    emptyFindings = await freshFindings();
    const v = await runInvariants(s, emptyFindings);
    expect(v.map((x) => x.code)).toContain("stale-spawn");
  });

  // Property: a freshly-initialized state with no progress beyond pending phases
  // never trips INV_001..INV_007 (only INV_008 trips on findings, which we keep empty).
  it("property: random fresh init never violates phase-coupling invariants", async () => {
    emptyFindings = await freshFindings();
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("simple", "medium", "complex"),
        fc.constantFrom("tdd", "regression-only"),
        async (complexity, testsMode) => {
          const s = baseState();
          s.complexity = complexity;
          s.tests_mode = testsMode;
          const v = await runInvariants(s, emptyFindings);
          const codes = v.map((x) => x.code);
          expect(codes).not.toContain("INV_001");
          expect(codes).not.toContain("INV_002");
          expect(codes).not.toContain("INV_003");
          expect(codes).not.toContain("INV_004");
          expect(codes).not.toContain("INV_005");
          expect(codes).not.toContain("INV_006");
          expect(codes).not.toContain("INV_007");
        },
      ),
      { numRuns: 30 },
    );
  });

  // Property: setting gate1=approved with planning in any non-{completed,skipped} status
  // ALWAYS produces INV_005.
  it("property: gate1=approved + planning not done → always INV_005", async () => {
    emptyFindings = await freshFindings();
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("pending", "in_progress"),
        async (planningStatus) => {
          const s = baseState();
          s.gates.gate1 = "approved";
          s.phases.planning.status = planningStatus;
          const v = await runInvariants(s, emptyFindings);
          expect(v.map((x) => x.code)).toContain("INV_005");
        },
      ),
      { numRuns: 20 },
    );
  });

  // Property: a happy walk-through is invariant-clean.
  it("property: a happy walk-through is invariant-clean", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "test_first",
        status: "skipped",
        skipped_reason: "regression-only",
      });
      await spawnNonreview(proj.dir, "implementation", "implementer");
      // Q68 / D7: a clean happy-walk has the impl reviewer APPROVE with no
      // blockers so the downstream acceptance PASS does not trip INV_013.
      await spawnReviewer(proj.dir, "implementation", "logic-reviewer", reviewerOutput({ verdict: "APPROVE", findings: [] }));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "implementation", status: "completed" });
      await spawnReviewer(proj.dir, "validation", "acceptance", validatorOutput());
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "validation", status: "completed" });
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "final", status: "completed" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate0", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate1", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "approved" });
      const { pipelineValidate } = await import("../../src/tools/validate.js");
      const v = await pipelineValidate({ project_dir: proj.dir });
      expect(v.ok).toBe(true);
    } finally {
      await proj.cleanup();
    }
  });
});
