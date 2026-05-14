/**
 * Q41: minimal YAML frontmatter parser tailored to the constrained shape
 * used by `agents/references/*.md`. Avoids a runtime dep (gray-matter is
 * ~30KB unpacked and pulls js-yaml). We only need to parse:
 *
 *   ---
 *   tags: [a, b, c]
 *   stack_signals:
 *     - language: typescript
 *     - project_type: [frontend-app, monorepo]
 *   summary: |
 *     Short single- or multi-line summary string.
 *   when_to_load: |
 *     Prose conditions for when this ref is relevant.
 *   agent_hints: [logic-reviewer, performance-reviewer]
 *   ---
 *
 * Out of scope: nested mappings beyond what `stack_signals` uses, anchors,
 * tags, multi-document streams, flow-style maps. If a ref author tries to
 * use them, parse returns the keys that did parse and the rest is ignored.
 *
 * Returns `{ data, body }` mimicking gray-matter so callers can swap in
 * the dependency later without rewriting consumers.
 */

export interface FrontmatterResult {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse a `---`-delimited YAML frontmatter block from the head of `source`.
 * If no frontmatter block is present, returns `{ data: {}, body: source }`.
 */
export function parseFrontmatter(source: string): FrontmatterResult {
  const m = source.match(FRONTMATTER_RE);
  if (!m) return { data: {}, body: source };
  const yamlBlock = m[1];
  const body = source.slice(m[0].length);
  return { data: parseYamlBlock(yamlBlock), body };
}

/**
 * Parse the constrained subset of YAML described above. Single pass over
 * lines; tracks indentation for the `key: |` and `- key: value` sub-cases
 * we need.
 */
function parseYamlBlock(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const topMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!topMatch) {
      i++;
      continue;
    }
    const key = topMatch[1];
    const rest = topMatch[2];
    if (rest === "|" || rest === ">") {
      // Block scalar — collect indented lines that follow.
      const collected: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (next === "" || /^\s/.test(next)) {
          collected.push(next.replace(/^  /, ""));
          i++;
        } else {
          break;
        }
      }
      out[key] = collected.join("\n").trim();
      continue;
    }
    if (rest === "") {
      // Nested mapping — sequence of indented `- key: value` entries.
      const seq: Array<Record<string, unknown>> = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        const m2 = next.match(/^\s*-\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
        if (!m2) {
          if (/^\s*$/.test(next)) {
            i++;
            continue;
          }
          break;
        }
        seq.push({ [m2[1]]: parseScalarOrList(m2[2]) });
        i++;
      }
      out[key] = seq;
      continue;
    }
    // Inline scalar or [a, b, c] list.
    out[key] = parseScalarOrList(rest);
    i++;
  }
  return out;
}

function parseScalarOrList(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => stripQuotes(s.trim()));
  }
  return stripQuotes(trimmed);
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}
