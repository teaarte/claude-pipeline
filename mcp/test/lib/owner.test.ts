import { describe, it, expect } from "vitest";
import {
  currentOwnerId,
  ownerCheck,
  OWNER_ID_ENV_VARS,
  OWNER_MISMATCH_CODE,
  CROSS_OWNER_VIOLATION,
} from "../../src/lib/owner.js";

describe("currentOwnerId — env-var chain (v2.2.6 C8)", () => {
  it("prefers CLAUDE_PIPELINE_OWNER_ID when set", () => {
    expect(
      currentOwnerId({
        CLAUDE_PIPELINE_OWNER_ID: "explicit-owner",
        CLAUDE_SESSION_ID: "cc-session",
        SESSION_ID: "generic",
      }),
    ).toBe("explicit-owner");
  });

  it("falls back to CLAUDE_SESSION_ID when explicit override absent", () => {
    expect(
      currentOwnerId({
        CLAUDE_SESSION_ID: "cc-session",
        SESSION_ID: "generic",
      }),
    ).toBe("cc-session");
  });

  it("falls back to generic SESSION_ID last", () => {
    expect(currentOwnerId({ SESSION_ID: "generic" })).toBe("generic");
  });

  it("returns null when no owner env var is set", () => {
    expect(currentOwnerId({})).toBeNull();
  });

  it("treats empty strings as unset (continues chain)", () => {
    expect(
      currentOwnerId({
        CLAUDE_PIPELINE_OWNER_ID: "",
        CLAUDE_SESSION_ID: "cc-session",
      }),
    ).toBe("cc-session");
  });

  it("OWNER_ID_ENV_VARS preserves intentional precedence", () => {
    expect(OWNER_ID_ENV_VARS[0]).toBe("CLAUDE_PIPELINE_OWNER_ID");
    expect(OWNER_ID_ENV_VARS[1]).toBe("CLAUDE_SESSION_ID");
    expect(OWNER_ID_ENV_VARS[2]).toBe("SESSION_ID");
  });
});

describe("ownerCheck", () => {
  it("returns match when both ids agree", () => {
    expect(ownerCheck("session-a", "session-a")).toEqual({ kind: "match" });
  });

  it("returns no-owner-recorded when state has no owner (legacy pre-C8 state)", () => {
    expect(ownerCheck(null, "session-a")).toEqual({ kind: "no-owner-recorded" });
    expect(ownerCheck(undefined, "session-a")).toEqual({ kind: "no-owner-recorded" });
  });

  it("returns no-current-owner when state has owner but env is empty", () => {
    expect(ownerCheck("session-a", null)).toEqual({ kind: "no-current-owner" });
  });

  it("returns mismatch with expected + actual when they differ", () => {
    expect(ownerCheck("session-a", "session-b")).toEqual({
      kind: "mismatch",
      expected: "session-a",
      actual: "session-b",
    });
  });
});

describe("public error codes", () => {
  it("exposes the OWNER_MISMATCH error code string", () => {
    expect(OWNER_MISMATCH_CODE).toBe("OWNER_MISMATCH");
  });

  it("exposes the cross-owner-finalize pipeline_violation tag", () => {
    expect(CROSS_OWNER_VIOLATION).toBe("cross-owner-finalize");
  });
});
