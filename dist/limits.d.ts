import { LimitEvent } from "./types";
export declare class LimitDetector {
    /** Lines the user submitted recently (to avoid matching their own pasted code). */
    private recentInput;
    noteUserInput(line: string): void;
    /** Scan a chunk of PTY output. Returns the strongest event, or null. */
    scan(chunk: string): LimitEvent | null;
}
/** Guards against burning through every account in a limit storm. */
export declare class SwitchGuard {
    private readonly max;
    private readonly windowMs;
    private times;
    constructor(max: number, windowMs: number);
    record(): void;
    /** True when too many switches happened recently — caller should pause autoswitch. */
    tripped(): boolean;
    count(): number;
    reset(): void;
}
/** Best-effort conversation id capture for --conversation <id> resume.
 * Strict on purpose: requires a `:` or `=` separator so prose like
 * "previous conversation" doesn't produce false ids. */
export declare function extractConversationId(text: string): string | null;
