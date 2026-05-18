/**
 * H1 regression — Item 8 zod schema for `user-answer` must accept
 * {decision, message?} and reject legacy {answer}. The handler already
 * reads evt.decision / evt.message; tests calling pipelineContinueTask
 * directly bypass zod, so this file pins the schema itself.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { continueTaskSchema } from "../../../src/driver/tools/continue-task.js";

const inputSchema = z.object(continueTaskSchema);

describe("H1 — continue-task zod boundary", () => {
  it("accepts structured user-answer with accept decision", () => {
    const r = inputSchema.safeParse({
      project_dir: "/tmp/x",
      driver_state_id: "ds-1",
      input: {
        driver_state_id: "ds-1",
        type: "user-answer",
        decision: "accept",
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts structured user-answer with reject + message", () => {
    const r = inputSchema.safeParse({
      project_dir: "/tmp/x",
      driver_state_id: "ds-1",
      input: {
        driver_state_id: "ds-1",
        type: "user-answer",
        decision: "reject",
        message: "classification wrong",
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects legacy {answer: string} shape", () => {
    const r = inputSchema.safeParse({
      project_dir: "/tmp/x",
      driver_state_id: "ds-1",
      input: {
        driver_state_id: "ds-1",
        type: "user-answer",
        answer: "yes",
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid decision values", () => {
    const r = inputSchema.safeParse({
      project_dir: "/tmp/x",
      driver_state_id: "ds-1",
      input: {
        driver_state_id: "ds-1",
        type: "user-answer",
        decision: "approve",
      },
    });
    expect(r.success).toBe(false);
  });
});
