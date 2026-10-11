import { Account, State } from "./types";
import { Terminal } from "./terminal";
import { PtyHost } from "./pty_host";
import { InputRouter } from "./input";
export interface FlowContext {
    term: Terminal;
    pty: PtyHost;
    state: State;
    cwd: string;
    router: InputRouter;
    refreshStatus(extra?: string): void;
    recentOutput(): string;
    conversationId(): string | null;
}
export declare function switchFlow(ctx: FlowContext, target: Account | null, reason: string, signal?: string): Promise<boolean>;
export declare function addFlow(ctx: FlowContext, sessionRunning: boolean): Promise<void>;
export declare function writeHandoffFile(ctx: FlowContext, from: Account | null, to: Account, reason: string): string;
