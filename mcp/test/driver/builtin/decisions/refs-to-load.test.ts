import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { refsToLoadDecision, buildSelectionPrompt, parsePickedRefs } from "../../../../src/driver/builtin/decisions/refs-to-load.js";
import {
  loadRefsMetadata,
  __resetRefsMetadataCacheForTests,
} from "../../../../src/driver/builtin/decisions/refs-metadata.js";
import type { DriverState, SpawnProviderPlugin } from "../../../../src/driver/types/plugin.js";
import { pipelineRoot } from "../../../../src/lib/paths.js";

function baseState(overrides: Partial<DriverState> = {}): DriverState {
  return {
    schema_version: "1.0",
    driver_state_id: "ds-test",
    project_dir: "/tmp/test-project",
    task: "test task",
    task_id: "t-2026-05-14-test",
    flow_name: "medium",
    step_index: 0,
    started_at: new Date().toISOString(),
    pending_spawns: {},
    pending_user_answer: null,
    decisions: {},
    complete: false,
    verdict: null,
    scratch: {},
    ...overrides,
  };
}

function mockProvider(queryImpl: (req: any) => Promise<string>): SpawnProviderPlugin {
  return {
    name: "mock",
    async spawn() {
      throw new Error("spawn not used in this test");
    },
    query: queryImpl,
  };
}

describe("refsToLoadDecision (Q41)", () => {
  beforeEach(() => {
    __resetRefsMetadataCacheForTests();
  });

  it("returns cached result when state.decisions already populated", async () => {
    const state = baseState({ decisions: { refs_to_load: ["agents/references/perf-react.md"] } });
    const provider = mockProvider(async () => {
      throw new Error("query must not run when cached");
    });
    const result = await refsToLoadDecision.decide(state, { spawn_provider: provider });
    expect(result).toEqual(["agents/references/perf-react.md"]);
  });

  it("LLM path: passes task + stack + agents + ref metadata in the prompt and returns parsed selection", async () => {
    let capturedPrompt = "";
    const provider = mockProvider(async (req) => {
      capturedPrompt = req.prompt;
      return JSON.stringify([
        "agents/references/perf-react.md",
        "agents/references/react19.md",
      ]);
    });
    const state = baseState({
      task: "Add memoization to dashboard list rendering",
      scratch: { stack: { language: "typescript", project_type: "frontend-app" } },
    });
    const result = await refsToLoadDecision.decide(state, {
      active_agents: ["plan", "review"],
      spawn_provider: provider,
    });
    expect(result).toEqual([
      "agents/references/perf-react.md",
      "agents/references/react19.md",
    ]);
    expect(capturedPrompt).toContain("Add memoization to dashboard list rendering");
    expect(capturedPrompt).toContain("typescript");
    expect(capturedPrompt).toContain("plan, review");
    expect(capturedPrompt).toContain("agents/references/perf-react.md");
  });

  it("caps LLM output at 5 entries even if more come back", async () => {
    const refs = await loadRefsMetadata();
    const all = refs.slice(0, 8).map((r) => r.filename);
    const provider = mockProvider(async () => JSON.stringify(all));
    const state = baseState({ task: "Generic task" });
    const result = await refsToLoadDecision.decide(state, {
      active_agents: [],
      spawn_provider: provider,
    });
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("falls back to regex selection when SpawnProvider.query throws", async () => {
    const provider = mockProvider(async () => {
      throw new Error("classification failed");
    });
    const state = baseState({ task: "Add auth-token decoder with JWT refresh" });
    const result = await refsToLoadDecision.decide(state, {
      active_agents: [],
      spawn_provider: provider,
    });
    expect(result).toContain("agents/references/security-backend.md");
  });

  it("falls back to regex selection when provider has no query() method", async () => {
    const state = baseState({ task: "Refactor service for concurrent request handling and retry" });
    const result = await refsToLoadDecision.decide(state, {
      active_agents: [],
      spawn_provider: null,
    });
    expect(result).toContain("agents/references/concurrency.md");
  });

  it("filters hallucinated filenames out of the LLM output", async () => {
    const provider = mockProvider(async () =>
      JSON.stringify([
        "agents/references/perf-react.md", // real
        "agents/references/does-not-exist.md", // hallucinated
      ]),
    );
    const state = baseState({ task: "Generic task" });
    const result = await refsToLoadDecision.decide(state, {
      active_agents: [],
      spawn_provider: provider,
    });
    expect(result).toContain("agents/references/perf-react.md");
    expect(result).not.toContain("agents/references/does-not-exist.md");
  });

  it("returns empty array gracefully when LLM emits malformed output", async () => {
    const provider = mockProvider(async () => "not json at all");
    const state = baseState({ task: "Unrelated work" });
    const result = await refsToLoadDecision.decide(state, {
      active_agents: [],
      spawn_provider: provider,
    });
    // fallback fires; empty regex match → empty list
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("buildSelectionPrompt (Q41)", () => {
  it("includes cap, task, stack, agents, and ref summaries", () => {
    const prompt = buildSelectionPrompt({
      task: "T",
      stack: { language: "python" },
      active_agents: ["review", "security"],
      refs: [
        {
          filename: "agents/references/foo.md",
          tags: ["a"],
          stack_signals: [],
          summary: "S",
          when_to_load: "W",
          agent_hints: ["logic-reviewer"],
        },
      ],
      cap: 3,
    });
    expect(prompt).toContain("at most 3");
    expect(prompt).toContain("python");
    expect(prompt).toContain("review, security");
    expect(prompt).toContain("agents/references/foo.md");
    expect(prompt).toContain("summary: S");
  });
});

describe("parsePickedRefs (Q41)", () => {
  const knownRefs = [
    { filename: "a.md", tags: [], stack_signals: [], summary: "", when_to_load: "", agent_hints: [] },
    { filename: "b.md", tags: [], stack_signals: [], summary: "", when_to_load: "", agent_hints: [] },
  ];
  it("strips ``` fences around the JSON array", () => {
    const out = parsePickedRefs("```json\n[\"a.md\"]\n```", knownRefs);
    expect(out).toEqual(["a.md"]);
  });
  it("returns [] on parse error", () => {
    const out = parsePickedRefs("totally not json", knownRefs);
    expect(out).toEqual([]);
  });
  it("returns [] on non-array", () => {
    const out = parsePickedRefs("\"a.md\"", knownRefs);
    expect(out).toEqual([]);
  });
});

describe("loadRefsMetadata (Q41)", () => {
  beforeEach(() => {
    __resetRefsMetadataCacheForTests();
  });

  it("loads every agents/references/*.md file with valid frontmatter", async () => {
    const refs = await loadRefsMetadata();
    expect(refs.length).toBeGreaterThanOrEqual(20);
    const filesOnDisk = (
      await readdir(join(pipelineRoot, "agents", "references"))
    ).filter((f) => f.endsWith(".md"));
    expect(refs.length).toBe(filesOnDisk.length);
    for (const ref of refs) {
      expect(ref.filename).toMatch(/^agents\/references\/.*\.md$/);
      expect(ref.tags.length).toBeGreaterThan(0);
      expect(ref.summary.length).toBeGreaterThan(0);
      expect(ref.when_to_load.length).toBeGreaterThan(0);
    }
  });
});
