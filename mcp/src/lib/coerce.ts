/**
 * Coerce a possibly-stringified integer to a number. Accepts:
 *   - number → returned as-is (must be a non-negative integer)
 *   - string of decimal digits → parsed
 * Rejects approximations like "~5", "3-4", "lots", "many", "" — these surface
 * in agent outputs and silently corrupt counters if accepted, so we throw a
 * pointed error pointing the caller at the right shape.
 */
export function coerceInteger(value: unknown, fieldName: string): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${fieldName}: ${value} is not a non-negative integer.`);
    }
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(
        `${fieldName}: '${value}' is approximate; pass an exact integer or omit the field.`,
      );
    }
    return parseInt(trimmed, 10);
  }
  throw new Error(`${fieldName}: expected number, got ${typeof value}`);
}

/**
 * Like coerceInteger but returns undefined when the input is undefined/null —
 * use for optional fields.
 */
export function coerceIntegerOpt(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return coerceInteger(value, fieldName);
}
