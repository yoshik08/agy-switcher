import { Account, State } from "./types";
export declare const bold: (s: string) => string;
export declare const dim: (s: string) => string;
export declare const red: (s: string) => string;
export declare const green: (s: string) => string;
export declare const yellow: (s: string) => string;
export declare const blue: (s: string) => string;
export declare const magenta: (s: string) => string;
export declare const cyan: (s: string) => string;
export declare const gray: (s: string) => string;
export declare function tag(): string;
export declare function info(msg: string): void;
export declare function ok(msg: string): void;
export declare function warn(msg: string): void;
export declare function err(msg: string): void;
export declare function table(headers: string[], rows: string[][]): void;
export declare function banner(version: string): void;
/** One-line status bar: fits the terminal width, truncated if needed. */
export declare function statusBar(state: State, cols: number, extra?: string): string;
export declare function relTime(v: string | null | undefined): string;
/** A clean full-width panel block for flow progress (switch/add). */
export declare function panel(title: string, lines: string[]): string;
export declare function accountLabel(a: Account): string;
export declare const HELP_TEXT: string;
