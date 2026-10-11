export type InputMode = "agy" | "palette" | "blocking";
export interface RouterEvents {
    /** A keystroke for agy (already filtered). */
    onAgyKey(ch: string): void;
    /** User asked for the command palette. */
    onPaletteOpen(prefill: string): void;
    /** Keystroke while the palette is open. */
    onPaletteKey(ch: string): void;
    /** Keystroke while a blocking flow runs. Return true if handled. */
    onBlockingKey(ch: string): boolean;
}
export declare class InputRouter {
    private readonly events;
    private mode;
    private decoder;
    private line;
    private lineTrusted;
    private esc;
    constructor(events: RouterEvents);
    get current(): InputMode;
    setMode(m: InputMode): void;
    attach(): void;
    detach(): void;
    private onData;
    /** Route a single keystroke. Public for testing. */
    handleKey(ch: string): void;
    private route;
    private routeAgy;
    /** The app calls this when it submits a line to agy by other means. */
    noteExternalSubmit(): void;
}
