// Deterministic fast-path: single-letter and carrier-mandated keywords resolve
// without an LLM call. Cheap, instant, and reliable — the LLM only sees
// messages this can't handle.

import type { Intent } from "./intents";

/** Returns an intent for keyword messages, or null to fall through to the LLM. */
export function fastPath(message: string): Intent | null {
  const text = message.trim();
  const upper = text.toUpperCase();

  // Opt-out keywords. No carrier enforces these on Telegram — honoring
  // STOP is entirely on us, so it must pause alerts and go silent.
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(upper)) {
    return { kind: "pause_alerts" };
  }
  if (["START", "UNSTOP", "RESUME"].includes(upper)) {
    return { kind: "resume_alerts" };
  }
  if (["HELP", "INFO", "?"].includes(upper)) {
    return { kind: "help" };
  }

  if (upper === "A" || upper === "ANALYZE" || upper === "ANALYSIS") {
    return { kind: "full_analysis", deal: null };
  }
  if (upper === "S" || upper === "SAVE") {
    return { kind: "save", deal: null };
  }
  if (upper === "P" || upper === "PASS") {
    return { kind: "pass", deal: null, reason: null };
  }

  // "P — too far east" / "P, needs too much work": pass plus a taste signal.
  const passWithReason = /^P\b[\s,—:-]+(.{2,})$/i.exec(text);
  if (passWithReason) {
    return { kind: "pass", deal: null, reason: passWithReason[1].trim() };
  }

  return null;
}
