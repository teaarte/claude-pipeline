import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { templatesDir } from "./paths.js";

function get(obj: any, path: string): any {
  return path.split(".").reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

let cachedTemplate: string | null = null;

async function loadTemplate(): Promise<string> {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = await readFile(join(templatesDir, "pipeline-state-summary.md"), "utf8");
  return cachedTemplate;
}

export async function buildSummary(state: any): Promise<string> {
  const tpl = await loadTemplate();
  return tpl.replace(/\{\{([^}]+)\}\}/g, (_full, expr: string) => {
    const value = get(state, expr.trim());
    if (value === undefined || value === null) return "—";
    return String(value);
  });
}
