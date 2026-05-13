import { describe, it, expect } from "vitest";
import { coerceInteger, coerceIntegerOpt } from "../../src/lib/coerce.js";

describe("coerceInteger", () => {
  it("passes through non-negative integers unchanged", () => {
    expect(coerceInteger(0, "x")).toBe(0);
    expect(coerceInteger(7, "x")).toBe(7);
  });

  it("parses decimal-digit strings", () => {
    expect(coerceInteger("3", "x")).toBe(3);
    expect(coerceInteger("  42 ", "x")).toBe(42);
  });

  it("rejects negatives and floats", () => {
    expect(() => coerceInteger(-1, "x")).toThrow(/non-negative integer/);
    expect(() => coerceInteger(1.5, "x")).toThrow(/non-negative integer/);
  });

  it("rejects approximations with a helpful error", () => {
    expect(() => coerceInteger("~5", "iterations")).toThrow(/approximate/);
    expect(() => coerceInteger("3-4", "iterations")).toThrow(/approximate/);
    expect(() => coerceInteger("lots", "iterations")).toThrow(/approximate/);
    expect(() => coerceInteger("many", "iterations")).toThrow(/approximate/);
    expect(() => coerceInteger("3 or 4", "iterations")).toThrow(/approximate/);
  });

  it("rejects empty / whitespace strings", () => {
    expect(() => coerceInteger("", "x")).toThrow(/approximate/);
    expect(() => coerceInteger("   ", "x")).toThrow(/approximate/);
  });

  it("rejects non-number, non-string types", () => {
    expect(() => coerceInteger(true as any, "x")).toThrow(/expected number/);
    expect(() => coerceInteger({} as any, "x")).toThrow(/expected number/);
  });
});

describe("coerceIntegerOpt", () => {
  it("returns undefined for undefined / null", () => {
    expect(coerceIntegerOpt(undefined, "x")).toBeUndefined();
    expect(coerceIntegerOpt(null, "x")).toBeUndefined();
  });

  it("delegates to coerceInteger for non-nullish input", () => {
    expect(coerceIntegerOpt("9", "x")).toBe(9);
    expect(() => coerceIntegerOpt("~9", "x")).toThrow(/approximate/);
  });
});
