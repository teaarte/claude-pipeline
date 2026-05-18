import { describe, it, expect } from "vitest";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
const templateDir = join(here, "..", "..", "..", "..", "..", "src", "driver", "bundles", "_template");

describe("bundles/_template skeleton (item 3)", () => {
  it("README.md exists and documents bundle authoring", async () => {
    const readmePath = join(templateDir, "README.md");
    await access(readmePath, constants.F_OK);
    const md = await readFile(readmePath, "utf8");
    expect(md).toContain("BundleManifest");
    expect(md).toContain("pipeline.config.json");
  });

  it("bundle.ts exists as a stub for future bundle authors", async () => {
    const bundlePath = join(templateDir, "bundle.ts");
    await access(bundlePath, constants.F_OK);
    const src = await readFile(bundlePath, "utf8");
    expect(src).toContain("BundleManifest");
  });

  it("code bundle moved into bundles/code/", async () => {
    const codeAgents = join(templateDir, "..", "code", "agents", "index.ts");
    await access(codeAgents, constants.F_OK);
  });

  it("code bundle ships task-prompt.md + done-prompt.md (item 5)", async () => {
    const taskPrompt = join(templateDir, "..", "code", "task-prompt.md");
    const donePrompt = join(templateDir, "..", "code", "done-prompt.md");
    await access(taskPrompt, constants.F_OK);
    await access(donePrompt, constants.F_OK);
    const taskMd = await readFile(taskPrompt, "utf8");
    const doneMd = await readFile(donePrompt, "utf8");
    expect(taskMd).toContain("Code bundle");
    expect(doneMd).toContain("pipeline_finish");
  });
});
