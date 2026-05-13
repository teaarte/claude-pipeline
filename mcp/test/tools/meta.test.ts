import { describe, it, expect } from "vitest";
import { pipelineMeta, PROTOCOL_VERSION } from "../../src/tools/meta.js";
import { PLUGIN_API_VERSION } from "../../src/driver/types/plugin.js";

describe("pipeline_meta", () => {
  it("returns versioned metadata", async () => {
    const m = await pipelineMeta({});
    expect(m.protocol_version).toBe(PROTOCOL_VERSION);
    expect(m.protocol_version).toBe("2.0");
    expect(m.plugin_api_version).toBe(PLUGIN_API_VERSION);
    expect(m.plugin_api_version).toBe("1.0");
    expect(m.schema_versions["pipeline-state"]).toBe("1.0");
    expect(m.schema_versions["finding"]).toBe("1.0");
    expect(m.tools.length).toBeGreaterThanOrEqual(17);
    expect(m.tools).toContain("pipeline_run_task");
    expect(m.tools).toContain("pipeline_meta");
  });
});
