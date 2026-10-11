"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwitchGuard = exports.LimitDetector = void 0;
exports.extractConversationId = extractConversationId;
const HARD = [
    { re: /resource_exhausted/i, signal: "RESOURCE_EXHAUSTED" },
    { re: /quota\s*exceeded/i, signal: "quota exceeded" },
    { re: /\brate[\s_-]*limit\b[^.\n]{0,60}\bexceeded\b/i, signal: "rate limit exceeded" },
    { re: /\b429\b[^.\n]{0,80}\b(too many requests|quota|exceeded|limit)\b/i, signal: "HTTP 429" },
    { re: /\b(too many requests|quota|exceeded|limit)\b[^.\n]{0,80}\b429\b/i, signal: "HTTP 429" },
    { re: /error[^.\n]{0,60}\b429\b/i, signal: "HTTP 429" },
    { re: /\b429\b[^.\n]{0,60}\berror\b/i, signal: "HTTP 429" },
];
const SOFT = [
    { re: /quota\s+(is\s+)?(almost|nearly)\s+(exhausted|used(\s+up)?)/i, signal: "quota nearly exhausted" },
    { re: /(\b9\d|\b100)\s*%\s*(of\s+)?(quota\s+)?(used|consumed)/i, signal: "quota over 90% used" },
];
class LimitDetector {
    /** Lines the user submitted recently (to avoid matching their own pasted code). */
    recentInput = [];
    noteUserInput(line) {
        const t = line.trim();
        if (t) {
            this.recentInput.push(t.slice(0, 200));
            if (this.recentInput.length > 20)
                this.recentInput.shift();
        }
    }
    /** Scan a chunk of PTY output. Returns the strongest event, or null. */
    scan(chunk) {
        // If the chunk is just an echo of something the user typed, skip it.
        const trimmed = chunk.replace(/[\r\n]+/g, " ").trim().slice(0, 400);
        if (trimmed && this.recentInput.some((l) => trimmed.includes(l) || l.includes(trimmed))) {
            return null;
        }
        for (const p of HARD) {
            if (p.re.test(chunk))
                return { kind: "hard", signal: p.signal, at: Date.now() };
        }
        for (const p of SOFT) {
            if (p.re.test(chunk))
                return { kind: "soft", signal: p.signal, at: Date.now() };
        }
        return null;
    }
}
exports.LimitDetector = LimitDetector;
/** Guards against burning through every account in a limit storm. */
class SwitchGuard {
    max;
    windowMs;
    times = [];
    constructor(max, windowMs) {
        this.max = max;
        this.windowMs = windowMs;
    }
    record() {
        const now = Date.now();
        this.times.push(now);
        this.times = this.times.filter((t) => now - t < this.windowMs);
    }
    /** True when too many switches happened recently — caller should pause autoswitch. */
    tripped() {
        const now = Date.now();
        this.times = this.times.filter((t) => now - t < this.windowMs);
        return this.times.length >= this.max;
    }
    count() {
        const now = Date.now();
        this.times = this.times.filter((t) => now - t < this.windowMs);
        return this.times.length;
    }
    reset() {
        this.times = [];
    }
}
exports.SwitchGuard = SwitchGuard;
/** Best-effort conversation id capture for --conversation <id> resume.
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
