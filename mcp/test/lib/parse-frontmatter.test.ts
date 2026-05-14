import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../src/lib/parse-frontmatter.js";

describe("parseFrontmatter", () => {
  it("returns empty data + full body when no frontmatter delimiter is present", () => {
    const out = parseFrontmatter("# Heading\n\nbody");
    expect(out.data).toEqual({});
    expect(out.body).toBe("# Heading\n\nbody");
  });

  it("parses tags, summary block, when_to_load block, agent_hints", () => {
    const src = [
      "---",
      "tags: [a, b, c]",
      "summary: |",
      "  Line one.",
      "  Line two.",
      "when_to_load: |",
      "  Condition A.",
      "agent_hints: [logic-reviewer, security-reviewer]",
      "---",
      "# Body",
    ].join("\n");
    const out = parseFrontmatter(src);
    expect(out.data.tags).toEqual(["a", "b", "c"]);
    expect(out.data.summary).toBe("Line one.\nLine two.");
    expect(out.data.when_to_load).toBe("Condition A.");
    expect(out.data.agent_hints).toEqual(["logic-reviewer", "security-reviewer"]);
    expect(out.body.trim()).toBe("# Body");
  });

  it("parses stack_signals as a sequence of single-key maps", () => {
    const src = [
      "---",
      "tags: [t]",
      "stack_signals:",
      "  - language: typescript",
      "  - project_type: [frontend-app, monorepo]",
      "summary: |",
      "  s",
      "when_to_load: |",
      "  w",
      "---",
      "body",
    ].join("\n");
    const out = parseFrontmatter(src);
    const signals = out.data.stack_signals as Array<Record<string, unknown>>;
    expect(Array.isArray(signals)).toBe(true);
    expect(signals[0]).toEqual({ language: "typescript" });
    expect(signals[1]).toEqual({ project_type: ["frontend-app", "monorepo"] });
  });

  it("tolerates missing frontmatter and returns body as-is", () => {
    const src = "no frontmatter here";
    const out = parseFrontmatter(src);
    expect(out.data).toEqual({});
    expect(out.body).toBe(src);
  });

  it("strips matching single and double quotes from scalar values", () => {
    const src = [
      "---",
      'tags: ["quoted", \'q2\', plain]',
      "summary: |",
      "  s",
      "when_to_load: |",
      "  w",
      "---",
    ].join("\n");
    const out = parseFrontmatter(src);
    expect(out.data.tags).toEqual(["quoted", "q2", "plain"]);
  });
});
