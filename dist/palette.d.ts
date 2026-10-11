import { Terminal } from "./terminal";
export interface PaletteCommand {
    name: string;
    usage: string;
    description: string;
    completeArg?: (partial: string) => string[];
}
export type PaletteOutcome = "done" | "cancelled" | "open";
export declare class Palette {
    private readonly term;
    private readonly commands;
    private active;
    private buf;
    private cursor;
    private sel;
    private matches;
    private drawnLines;
    private _result;
    constructor(term: Terminal, commands: PaletteCommand[]);
    get result(): {
        cmd: string;
        args: string[];
    } | null;
    get isOpen(): boolean;
    open(prefill: string): void;
    handleKey(ch: string): PaletteOutcome;
    private query;
    private refilter;
    private tabComplete;
    private submit;
    private cancel;
    private draw;
    private erase;
}
