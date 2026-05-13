/**
 * Extract the first fenced ```json block from agent output text.
 * Per agent-output-formats.md, this block is the machine-parseable header.
 */
export function extractJsonHeader(text: string): { ok: true; value: any } | { ok: false; reason: string } {
  const match = text.match(/```json\s*\r?\n([\s\S]*?)\r?\n```/);
  if (!match) {
    return { ok: false, reason: "no fenced ```json block found in agent output" };
  }
  const raw = match[1].trim();
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e: any) {
    return { ok: false, reason: `JSON parse error: ${e.message}` };
  }
}

const SLUG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

export function makeFindingId(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  }
  return `f-${y}-${m}-${d}-${suffix}`;
}
