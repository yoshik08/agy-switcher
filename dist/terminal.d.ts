export declare class Terminal {
    private raw;
    private statusReserved;
    private resizeHandlers;
    private sigtermHandlers;
    private lastStatus;
    get rows(): number;
    get cols(): number;
    /** Rows available to the PTY child (everything above the status bar). */
    get ptyRows(): number;
    get isTTY(): boolean;
    write(s: string): void;
    writeln(s?: string): void;
    enterRaw(): void;
    exitRaw(): void;
    get isRaw(): boolean;
    /** Pin the status bar to the bottom line. */
    reserveStatus(): void;
    releaseStatus(): void;
    renderStatus(text: string): void;
    clearStatus(): void;
    onResize(fn: () => void): void;
    onSigterm(fn: () => void): void;
    /** Restore the terminal to a sane state (call on exit). */
    restore(): void;
}
