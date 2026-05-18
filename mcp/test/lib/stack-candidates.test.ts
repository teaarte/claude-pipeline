import { describe, it, expect, beforeEach } from "vitest";
import {
  loadStackCandidates,
  parseStackCandidatesString,
  clearStackCandidatesCache,
} from "../../src/lib/stack-candidates.js";

const MIN_VALID = `
languages:
  - name: rust
    signal_files: ["Cargo.toml"]
    extensions: [".rs"]
package_managers:
  - name: cargo
    languages: [rust]
    signal_files: ["Cargo.toml"]
default_commands:
  - language: rust
    package_manager: cargo
    test: "cargo test"
    lint: "cargo clippy"
    build: "cargo build"
project_type_signals:
  - type: library
    signal_files: ["Cargo.toml"]
    package_json_deps: []
`;

describe("loadStackCandidates — production YAML", () => {
  beforeEach(() => {
    clearStackCandidatesCache();
  });

  it("loads templates/stack-candidates.yaml without throwing", async () => {
    const cands = await loadStackCandidates();
    expect(cands.languages.length).toBeGreaterThanOrEqual(8);
    expect(cands.package_managers.length).toBeGreaterThan(0);
    expect(cands.default_commands.length).toBeGreaterThan(0);
    expect(cands.project_type_signals.length).toBeGreaterThan(0);
  });

  it("covers the minimum ecosystems mandated by v2.2.6 (TS, JS, Python, Rust, Go, C#, Svelte, Elixir, Dart)", async () => {
    const cands = await loadStackCandidates();
    const names = new Set(cands.languages.map((l) => l.name));
    for (const required of [
      "typescript",
      "javascript",
      "python",
      "rust",
      "go",
      "csharp",
      "svelte",
      "elixir",
      "dart",
    ]) {
      expect(names.has(required), `missing language: ${required}`).toBe(true);
    }
  });

  it("caches: second load returns the same reference", async () => {
    const a = await loadStackCandidates();
    const b = await loadStackCandidates();
    expect(b).toBe(a);
  });

  it("ships at least one default_commands entry per (csharp, elixir, dart)", async () => {
    const cands = await loadStackCandidates();
    const langs = new Set(cands.default_commands.map((c) => c.language));
    expect(langs.has("csharp")).toBe(true);
    expect(langs.has("elixir")).toBe(true);
    expect(langs.has("dart")).toBe(true);
  });
});

describe("parseStackCandidatesString — Zod validation", () => {
  it("accepts the minimal valid shape", () => {
    const parsed = parseStackCandidatesString(MIN_VALID);
    expect(parsed.languages[0].name).toBe("rust");
    expect(parsed.package_managers[0].name).toBe("cargo");
  });

  it("rejects when a package_manager points to an unknown language", () => {
    const bad = MIN_VALID.replace("languages: [rust]", "languages: [crystal]");
    expect(() => parseStackCandidatesString(bad)).toThrow(
      /unknown language "crystal"/,
    );
  });

  it("rejects when default_commands references an unknown package_manager", () => {
    const bad = MIN_VALID.replace("package_manager: cargo", "package_manager: nimble");
    expect(() => parseStackCandidatesString(bad)).toThrow(
      /unknown package_manager "nimble"/,
    );
  });

  it("rejects when a required top-level key is missing", () => {
    const bad = MIN_VALID.replace(/project_type_signals:[\s\S]*/, "");
    expect(() => parseStackCandidatesString(bad)).toThrow(/Zod validation/);
  });

  it("rejects an empty languages list (Zod min(1))", () => {
    const bad = `
languages: []
package_managers:
  - name: cargo
    languages: [rust]
    signal_files: ["Cargo.toml"]
default_commands:
  - language: rust
    package_manager: cargo
    test: "cargo test"
    lint: "cargo clippy"
    build: "cargo build"
project_type_signals:
  - type: library
    signal_files: ["Cargo.toml"]
    package_json_deps: []
`;
    expect(() => parseStackCandidatesString(bad)).toThrow(/Zod validation/);
  });

  it("validates project_type enum", () => {
    const bad = MIN_VALID.replace("type: library", "type: not-a-real-type");
    expect(() => parseStackCandidatesString(bad)).toThrow(/Zod validation/);
  });

  it("accepts a project_type_signals row that references a known language", () => {
    const good = MIN_VALID + `    languages: [rust]\n`;
    const parsed = parseStackCandidatesString(good);
    expect(parsed.project_type_signals[0].languages).toEqual(["rust"]);
  });

  it("rejects a project_type_signals row that references an unknown language", () => {
    const bad = MIN_VALID + `    languages: [zig]\n`;
    expect(() => parseStackCandidatesString(bad)).toThrow(
      /project_type_signals .* unknown language "zig"/,
    );
  });
});

describe("parseStackCandidatesString — extensibility proof", () => {
  // Demonstrates: adding a new language is YAML-only — no TS edit needed.
  it("accepts a brand-new language (Crystal) with its own PM and command shape", () => {
    const withCrystal = `
languages:
  - name: crystal
    signal_files: ["shard.yml"]
    extensions: [".cr"]
package_managers:
  - name: shards
    languages: [crystal]
    signal_files: ["shard.lock"]
default_commands:
  - language: crystal
    package_manager: shards
    test: "crystal spec"
    lint: "ameba"
    build: "shards build"
project_type_signals:
  - type: library
    signal_files: ["shard.yml"]
    package_json_deps: []
`;
    const parsed = parseStackCandidatesString(withCrystal);
    expect(parsed.languages[0].name).toBe("crystal");
    expect(parsed.default_commands[0].test).toBe("crystal spec");
  });
});
