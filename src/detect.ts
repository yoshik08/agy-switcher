/* Detection helpers: limit signals, conversation ids, quota snippets.
 * All best-effort heuristics over terminal output — no agy internals required.
 */
import { LimitSignal } from "./types";

/** Strong hard-limit patterns. */
const HARD_PATTERNS: Array<{ re: RegExp; signal: string }> = [
  { re: /resource_exhausted/i, signal: "RESOURCE_EXHAUSTED" },
  { re: /quota\s*exceeded/i, signal: "quota exceeded" },
  { re: /rate[\s_-]*limit/i, signal: "rate limit" },
];

/** Bare 429 only counts when surrounded by error-ish context (avoids matching code the user is writing). */
const CODE_429 = /\b429\b/;
const ERROR_CONTEXT = /error|exceed|quota|limit|too many|usage|billing/i;

/** Soft "approaching limit" hints. */
const SOFT_PATTERNS: Array<{ re: RegExp; signal: string }> = [
  { re: /quota\s*(is\s*)?(almost|nearly)\s*(exhausted|used)/i, signal: "quota nearly exhausted" },
  { re: /(\d{1,3})\s*%\s*(of\s*)?(quota\s*)?(used|consumed)/i, signal: "high quota usage" },
  { re: /consider\s*switching\s*account/i, signal: "switch hint" },
];

/**
 * Scan a chunk of terminal output (plus a little trailing context) for limit signals.
 * Returns the strongest hit. Conservative by design: unknown output → no hit.
 */
export function detectLimit(chunk: string, contextTail = ""): LimitSignal {
  const hay = contextTail + "\n" + chunk;

  for (const p of HARD_PATTERNS) {
    if (p.re.test(hay)) return { hit: true, kind: "hard", signal: p.signal };
  }
  if (CODE_429.test(chunk)) {
    // look at the neighbourhood of the 429, not the whole buffer
    const idx = chunk.search(CODE_429);
    const near = chunk.slice(Math.max(0, idx - 160), idx + 160);
    if (ERROR_CONTEXT.test(near)) {
      return { hit: true, kind: "hard", signal: "HTTP 429" };
    }
  }
  for (const p of SOFT_PATTERNS) {
    if (p.re.test(hay)) return { hit: true, kind: "soft", signal: p.signal };
  }
  return { hit: false, kind: "hard", signal: "" };
}

/** Best-effort conversation/session id capture for --conversation <id> resume.
 * Strict on purpose: requires a `:` or `=` separator so prose like
 * "previous conversation" doesn't produce false ids. */
export function extractConversationId(text: string): string | null {
  const patterns = [
    /conversation(?:\s+id)?\s*[:=]\s*([A-Za-z0-9_-]{6,})/i,
    /session(?:\s+id)?\s*[:=]\s*([A-Za-z0-9_-]{6,})/i,
    /thread(?:\s+id)?\s*[:=]\s*([A-Za-z0-9_-]{6,})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && !/^(id|the|a)$/i.test(m[1])) return m[1];
  }
  return null;
}

export interface QuotaSignals {
  plan: string | null;
  quotaText: string | null;
}

/** Very conservative quota/plan snippet extraction from agy output. */
export function extractQuotaSignals(text: string): QuotaSignals {
  let plan: string | null = null;
  let quotaText: string | null = null;

  const planM = text.match(/google\s*ai\s*(pro|plus|ultra)/i) || text.match(/\bAI\s*(Pro|Plus|Ultra)\b/);
  if (planM) plan = `AI ${planM[1][0].toUpperCase()}${planM[1].slice(1).toLowerCase()}`;

  const qM =
    text.match(/(\d{1,3})\s*%\s*(remaining|left|available)/i) ||
    text.match(/(remaining|left)[^\n]{0,50}?(\d{1,3})\s*%/i);
  if (qM) {
    const pct = qM[1].match(/^\d+$/) ? qM[1] : qM[2];
    quotaText = `${pct}% remaining`;
  }
  return { plan, quotaText };
}

/**
 * Try to pull an email address out of a stored credential without knowing its format.
 * Handles: JSON blobs with email fields, and JWT access/id tokens.
 */
export function extractEmail(token: string): string | null {
  const t = token.trim();
  // JSON credential bundle?
  if (t.startsWith("{")) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      const candidates = [
        obj.email,
        obj.user_email,
        (obj.user as Record<string, unknown> | undefined)?.email,
        (obj.profile as Record<string, unknown> | undefined)?.email,
      ];
      for (const c of candidates) {
        if (typeof c === "string" && c.includes("@")) return c;
      }
    } catch {
      /* not parseable JSON */
    }
  }
  // JWT?
  const parts = t.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
      ) as Record<string, unknown>;
      if (typeof payload.email === "string" && payload.email.includes("@")) return payload.email;
    } catch {
      /* not a JWT */
    }
  }
  // Bare email string?
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return t;
  return null;
}

/** Parse a raw slash-command line into [command, args]. Returns null if not a slash command. */
export function parseSlash(line: string): { cmd: string; args: string[] } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1) };
}

export const KNOWN_COMMANDS = new Set([
  "add",
  "accounts",
  "list",
  "usage",
  "switch",
  "autoswitch-on",
  "autoswitch-off",
  "handoff",
  "help",
]);
