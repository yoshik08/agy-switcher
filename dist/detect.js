"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWN_COMMANDS = void 0;
exports.detectLimit = detectLimit;
exports.extractConversationId = extractConversationId;
exports.extractQuotaSignals = extractQuotaSignals;
exports.extractEmail = extractEmail;
exports.parseSlash = parseSlash;
/** Strong hard-limit patterns. */
const HARD_PATTERNS = [
    { re: /resource_exhausted/i, signal: "RESOURCE_EXHAUSTED" },
    { re: /quota\s*exceeded/i, signal: "quota exceeded" },
    { re: /rate[\s_-]*limit/i, signal: "rate limit" },
];
/** Bare 429 only counts when surrounded by error-ish context (avoids matching code the user is writing). */
const CODE_429 = /\b429\b/;
const ERROR_CONTEXT = /error|exceed|quota|limit|too many|usage|billing/i;
/** Soft "approaching limit" hints. */
const SOFT_PATTERNS = [
    { re: /quota\s*(is\s*)?(almost|nearly)\s*(exhausted|used)/i, signal: "quota nearly exhausted" },
    { re: /(\d{1,3})\s*%\s*(of\s*)?(quota\s*)?(used|consumed)/i, signal: "high quota usage" },
    { re: /consider\s*switching\s*account/i, signal: "switch hint" },
];
/**
 * Scan a chunk of terminal output (plus a little trailing context) for limit signals.
 * Returns the strongest hit. Conservative by design: unknown output → no hit.
 */
function detectLimit(chunk, contextTail = "") {
    const hay = contextTail + "\n" + chunk;
    for (const p of HARD_PATTERNS) {
        if (p.re.test(hay))
            return { hit: true, kind: "hard", signal: p.signal };
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
        if (p.re.test(hay))
            return { hit: true, kind: "soft", signal: p.signal };
    }
    return { hit: false, kind: "hard", signal: "" };
}
/** Best-effort conversation/session id capture for --conversation <id> resume.
 * Strict on purpose: requires a `:` or `=` separator so prose like
 * "previous conversation" doesn't produce false ids. */
function extractConversationId(text) {
    const patterns = [
        /conversation(?:\s+id)?\s*[:=]\s*([A-Za-z0-9_-]{6,})/i,
        /session(?:\s+id)?\s*[:=]\s*([A-Za-z0-9_-]{6,})/i,
        /thread(?:\s+id)?\s*[:=]\s*([A-Za-z0-9_-]{6,})/i,
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (m && !/^(id|the|a)$/i.test(m[1]))
            return m[1];
    }
    return null;
}
/** Very conservative quota/plan snippet extraction from agy output. */
function extractQuotaSignals(text) {
    let plan = null;
    let quotaText = null;
    const planM = text.match(/google\s*ai\s*(pro|plus|ultra)/i) || text.match(/\bAI\s*(Pro|Plus|Ultra)\b/);
    if (planM)
        plan = `AI ${planM[1][0].toUpperCase()}${planM[1].slice(1).toLowerCase()}`;
    const qM = text.match(/(\d{1,3})\s*%\s*(remaining|left|available)/i) ||
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
function extractEmail(token) {
    const t = token.trim();
    // JSON credential bundle?
    if (t.startsWith("{")) {
        try {
            const obj = JSON.parse(t);
            const candidates = [
                obj.email,
                obj.user_email,
                obj.user?.email,
                obj.profile?.email,
            ];
            for (const c of candidates) {
                if (typeof c === "string" && c.includes("@"))
                    return c;
            }
        }
        catch {
            /* not parseable JSON */
        }
    }
    // JWT?
    const parts = t.split(".");
    if (parts.length === 3) {
        try {
            const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
            if (typeof payload.email === "string" && payload.email.includes("@"))
                return payload.email;
        }
        catch {
            /* not a JWT */
        }
    }
    // Bare email string?
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t))
        return t;
    return null;
}
/** Parse a raw slash-command line into [command, args]. Returns null if not a slash command. */
function parseSlash(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("/"))
        return null;
    const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
    if (parts.length === 0)
        return null;
    return { cmd: parts[0].toLowerCase(), args: parts.slice(1) };
}
exports.KNOWN_COMMANDS = new Set([
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
