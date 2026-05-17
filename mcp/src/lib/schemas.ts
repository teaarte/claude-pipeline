import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { schemasDir } from "./paths.js";

let ajvInstance: Ajv2020 | null = null;
const compiled = new Map<string, ValidateFunction>();
let vocab: any = null;

async function getAjv(): Promise<Ajv2020> {
  if (ajvInstance) return ajvInstance;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  // Pre-load all schemas so $ref between them resolves.
  for (const name of [
    "finding.schema.json",
    "reviewer-output.schema.json",
    "validator-output.schema.json",
    "pipeline-state.schema.json",
    "agent-feedback.schema.json",
  ]) {
    const raw = await readFile(join(schemasDir, name), "utf8");
    ajv.addSchema(JSON.parse(raw));
  }
  // Bundle extensions: per-bundle conditional constraints layered on top of
  // the base pipeline-state schema. Registered under id
  // "bundle-extensions/<bundle>.schema.json".
  for (const name of ["code.schema.json"]) {
    const raw = await readFile(
      join(schemasDir, "bundle-extensions", name),
      "utf8",
    );
    ajv.addSchema(JSON.parse(raw));
  }
  ajvInstance = ajv;
  return ajv;
}

export async function getValidator(schemaId: string): Promise<ValidateFunction> {
  const cached = compiled.get(schemaId);
  if (cached) return cached;
  const ajv = await getAjv();
  const v = ajv.getSchema(schemaId);
  if (!v) throw new Error(`Schema not loaded: ${schemaId}`);
  compiled.set(schemaId, v);
  return v;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: { path: string; message: string }[] };

export async function validate(schemaId: string, data: unknown): Promise<ValidationResult> {
  const v = await getValidator(schemaId);
  const valid = v(data);
  if (valid) return { ok: true };
  const errors = (v.errors ?? []).map((e) => ({
    path: e.instancePath || "/",
    message: `${e.message ?? "invalid"}${
      e.params && Object.keys(e.params).length ? ` (${JSON.stringify(e.params)})` : ""
    }`,
  }));
  return { ok: false, errors };
}

/**
 * Validates pipeline-state.json against the base schema AND the appropriate
 * bundle extension. Old `1.0` state files without a `bundle` field default
 * to the code bundle (the code extension's `if` clause matches both
 * `bundle === "code"` and absent-bundle for backward-compat).
 *
 * Bundles without an extension file (synthetic test bundles, future bundles
 * that don't restrict additional shape) pass extension validation cleanly.
 */
export async function validatePipelineState(state: any): Promise<ValidationResult> {
  const base = await validate("pipeline-state.schema.json", state);
  if (!base.ok) return base;

  const bundle = typeof state?.bundle === "string" ? state.bundle : "code";
  const extId = `bundle-extensions/${bundle}.schema.json`;
  try {
    const v = await getValidator(extId);
    const ok = v(state);
    if (ok) return { ok: true };
    const errors = (v.errors ?? []).map((e) => ({
      path: e.instancePath || "/",
      message: `[${bundle}-extension] ${e.message ?? "invalid"}${
        e.params && Object.keys(e.params).length ? ` (${JSON.stringify(e.params)})` : ""
      }`,
    }));
    return { ok: false, errors };
  } catch {
    // No registered extension for this bundle — base validation suffices.
    return { ok: true };
  }
}

export async function getCategoryVocab(): Promise<any> {
  if (vocab) return vocab;
  const raw = await readFile(join(schemasDir, "category-vocab.json"), "utf8");
  vocab = JSON.parse(raw);
  return vocab;
}

export async function isCategoryAllowed(agent: string, category: string): Promise<boolean> {
  const v = await getCategoryVocab();
  const list: string[] | undefined = v?.vocab?.[agent];
  if (!list) return true; // unknown agent → don't block here
  return list.includes(category) || category === "other";
}
