export declare const bold: (s: string) => string;
export declare const dim: (s: string) => string;
export declare const red: (s: string) => string;
export declare const green: (s: string) => string;
export declare const yellow: (s: string) => string;
export declare const blue: (s: string) => string;
export declare const cyan: (s: string) => string;
export declare const gray: (s: string) => string;
/** Prefix for all geminiswitcher wrapper messages so they're distinguishable from agy output. */
export declare function tag(): string;
export declare function info(msg: string): void;
export declare function ok(msg: string): void;
export declare function warn(msg: string): void;
export declare function err(msg: string): void;
/** Simple left-aligned table printer. */
export declare function table(headers: string[], rows: string[][]): void;
export declare function banner(version: string): void;
export declare const HELP_TEXT: string;
