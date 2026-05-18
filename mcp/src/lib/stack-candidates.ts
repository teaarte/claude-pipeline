/**
 * v2.2.6: stack-candidate registry loader.
 *
 * Loads `templates/stack-candidates.yaml`, validates with Zod, caches the
 * parsed shape as a module-singleton (file is parsed once per process —
 * same pattern as `lib/schemas.ts`).
 *
 * Adding a new language / package manager / command shape = edit the YAML
 * file. No TypeScript change required (this file does not enumerate any
 * specific language).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { templatesDir } from "./paths.js";

const LanguageCandidateSchema = z.object({
  name: z.string().min(1),
  signal_files: z.array(z.string().min(1)).default([]),
  extensions: z.array(z.string().min(1)).default([]),
});

const PackageManagerCandidateSchema = z.object({
  name: z.string().min(1),
  languages: z.array(z.string().min(1)).min(1),
  signal_files: z.array(z.string().min(1)).default([]),
  package_json_field_prefix: z.string().min(1).optional(),
});

const DefaultCommandSchema = z.object({
  language: z.string().min(1),
  package_manager: z.string().min(1),
  test: z.string().nullable(),
  lint: z.string().nullable(),
  build: z.string().nullable(),
});

const PROJECT_TYPES = ["frontend-app", "backend", "library", "monorepo"] as const;
const ProjectTypeSchema = z.enum(PROJECT_TYPES);

const ProjectTypeSignalSchema = z.object({
  type: ProjectTypeSchema,
  signal_files: z.array(z.string().min(1)).default([]),
  package_json_deps: z.array(z.string().min(1)).default([]),
  languages: z.array(z.string().min(1)).optional(),
});

const StackCandidatesSchema = z.object({
  languages: z.array(LanguageCandidateSchema).min(1),
  package_managers: z.array(PackageManagerCandidateSchema).min(1),
  default_commands: z.array(DefaultCommandSchema).min(1),
  project_type_signals: z.array(ProjectTypeSignalSchema).min(1),
});

export type StackCandidates = z.infer<typeof StackCandidatesSchema>;
export type LanguageCandidate = z.infer<typeof LanguageCandidateSchema>;
export type PackageManagerCandidate = z.infer<typeof PackageManagerCandidateSchema>;
export type DefaultCommand = z.infer<typeof DefaultCommandSchema>;
export type ProjectTypeSignal = z.infer<typeof ProjectTypeSignalSchema>;
export type ProjectType = z.infer<typeof ProjectTypeSchema>;

let cached: StackCandidates | null = null;

export const stackCandidatesPath = join(templatesDir, "stack-candidates.yaml");

export async function loadStackCandidates(): Promise<StackCandidates> {
  if (cached) return cached;
  const raw = await readFile(stackCandidatesPath, "utf8");
  const parsed = parseStackCandidatesString(raw);
  cached = parsed;
  return parsed;
}

/**
 * Parse + validate from a string (used by tests with fixture YAML).
 * Cross-references languages ↔ package_managers ↔ default_commands so a
 * typo in the YAML fails fast at load time, not at lookup time.
 */
export function parseStackCandidatesString(yamlSource: string): StackCandidates {
  const obj = parseYaml(yamlSource);
  const result = StackCandidatesSchema.safeParse(obj);
  if (!result.success) {
    throw new Error(
      `stack-candidates.yaml failed Zod validation: ${result.error.message}`,
    );
  }
  const data = result.data;
  const languageNames = new Set(data.languages.map((l) => l.name));
  const pmNames = new Set(data.package_managers.map((p) => p.name));
  for (const pm of data.package_managers) {
    for (const lang of pm.languages) {
      if (!languageNames.has(lang)) {
        throw new Error(
          `stack-candidates.yaml: package_manager "${pm.name}" references unknown language "${lang}"`,
        );
      }
    }
  }
  for (const cmd of data.default_commands) {
    if (!languageNames.has(cmd.language)) {
      throw new Error(
        `stack-candidates.yaml: default_commands entry references unknown language "${cmd.language}"`,
      );
    }
    if (!pmNames.has(cmd.package_manager)) {
      throw new Error(
        `stack-candidates.yaml: default_commands entry references unknown package_manager "${cmd.package_manager}"`,
      );
    }
  }
  for (const sig of data.project_type_signals) {
    for (const lang of sig.languages ?? []) {
      if (!languageNames.has(lang)) {
        throw new Error(
          `stack-candidates.yaml: project_type_signals "${sig.type}" references unknown language "${lang}"`,
        );
      }
    }
  }
  return data;
}

/**
 * Reset the cached candidates. Tests use this to force re-load.
 */
export function clearStackCandidatesCache(): void {
  cached = null;
}
