import { Account, State } from "./types";
import { PaletteCommand } from "./palette";
export interface CmdEnv {
    state: State;
    switchTo(account: Account, reason: string): Promise<void>;
    addAccount(): Promise<void>;
    setAutoswitch(on: boolean): void;
    writeHandoff(reason: string): void;
    forwardToAgy(text: string): void;
    accountNames(partial: string): string[];
}
export declare function runCommand(name: string, args: string[], env: CmdEnv): Promise<void>;
/** Registry driving the palette (order = display order). */
export declare function commandRegistry(env: CmdEnv): PaletteCommand[];
