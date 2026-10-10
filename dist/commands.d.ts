import { State } from "./types";
import { Session } from "./session";
export interface CommandContext {
    session: Session;
    state: State;
    /** End the whole geminiswitcher session (quits agy too). */
    quit: () => Promise<void>;
}
export declare function handleSlashCommand(cmd: string, args: string[], ctx: CommandContext): Promise<void>;
