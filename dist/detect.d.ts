import { LimitSignal } from "./types";
/**
 * Scan a chunk of terminal output (plus a little trailing context) for limit signals.
 * Returns the strongest hit. Conservative by design: unknown output → no hit.
 */
export declare function detectLimit(chunk: string, contextTail?: string): LimitSignal;
/** Best-effort conversation/session id capture for --conversation <id> resume.
 * Strict on purpose: requires a `:` or `=` separator so prose like
 * "previous conversation" doesn't produce false ids. */
export declare function extractConversationId(text: string): string | null;
export interface QuotaSignals {
    plan: string | null;
    quotaText: string | null;
}
/** Very conservative quota/plan snippet extraction from agy output. */
export declare function extractQuotaSignals(text: string): QuotaSignals;
/**
 * Try to pull an email address out of a stored credential without knowing its format.
 * Handles: JSON blobs with email fields, and JWT access/id tokens.
 */
export declare function extractEmail(token: string): string | null;
/** Parse a raw slash-command line into [command, args]. Returns null if not a slash command. */
export declare function parseSlash(line: string): {
    cmd: string;
    args: string[];
} | null;
export declare const KNOWN_COMMANDS: Set<string>;
