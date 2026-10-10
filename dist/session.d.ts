import * as pty from "node-pty";
import { LimitSignal, State } from "./types";
export interface SessionCallbacks {
    /** A swallowed slash command line, e.g. "/switch work". */
    onSlash: (cmd: string, args: string[], rawLine: string) => Promise<void>;
    /** A limit signal was seen in agy output. */
    onLimit: (signal: LimitSignal) => Promise<void>;
    /** agy exited on its own (not via our restart). Session is over. */
    onEnd: (exitCode: number) => Promise<void>;
}
export declare class Session {
    state: State;
    readonly agyPath: string;
    readonly agyArgs: string[];
    readonly cwd: string;
    private cb;
    private child;
    private decoder;
    private shadow;
    private shadowDirty;
    private escBuf;
    private outputWindow;
    private expectingRestart;
    private switching;
    private ended;
    private lastConversationId;
    private lastLimitAt;
    constructor(state: State, agyPath: string, agyArgs: string[], cwd: string, cb: SessionCallbacks);
    get activeChild(): pty.IPty | null;
    get conversationId(): string | null;
    get recentOutput(): string;
    /** True while we are inside an automatic switch/restart sequence. */
    get busy(): boolean;
    set busy(v: boolean);
    /** Spawn agy in a PTY and wire everything up. */
    launch(extraArgs?: string[]): void;
    /** Attach stdin interception + resize handling. Call once per session. */
    attach(): void;
    /** Detach input handling (e.g. before running an external interactive command). */
    detach(): void;
    /** Permanently end the session (user quit). */
    end(): Promise<void>;
    /**
     * Kill the running agy so credentials can be swapped, then relaunch.
     * Used by autoswitch, /switch and /add.
     */
    restart(extraArgs?: string[]): Promise<void>;
    /** Kill the running agy WITHOUT relaunching (caller will relaunch later). */
    stopChild(): Promise<void>;
    /** Send raw text to agy as if the user typed it (used for /usage forwarding). */
    sendToAgy(text: string): void;
    private onSigTerm;
    private onResize;
    private enterRawMode;
    private exitRawMode;
    private onStdinData;
    private forward;
    private handleKey;
    private submitLine;
    private onPtyData;
    private scanOutput;
    private onPtyExit;
    private terminateChild;
    /** Print a wrapper line (used by command handlers). */
    print(msg: string): void;
}
