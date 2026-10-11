export interface PtyEvents {
    onData(data: string): void;
    onExit(code: number): void;
}
export declare class PtyHost {
    private readonly bin;
    private readonly baseArgs;
    private readonly cwd;
    private readonly events;
    private child;
    private expectExit;
    constructor(bin: string, baseArgs: string[], cwd: string, events: PtyEvents);
    get alive(): boolean;
    spawn(extraArgs: string[], cols: number, rows: number): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    /** SIGTERM, wait, then SIGKILL. Marks the exit as expected. */
    terminate(): Promise<void>;
    /** Was the most recent exit one we initiated? */
    get expectedExit(): boolean;
    killNow(): void;
}
