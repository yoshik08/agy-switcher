import { Settings } from "./types";
export declare const APP_NAME = "geminiswitcher";
export declare const VERSION = "1.0.0";
/** OS keyring slot that agy itself reads. Single-slot per machine. */
export declare const ACTIVE_SERVICE = "gemini";
export declare const ACTIVE_ACCOUNT = "antigravity";
/** Our own vault namespace inside the OS keyring (one entry per account). */
export declare const VAULT_SERVICE = "geminiswitcher";
export declare const vaultKey: (accountId: string) => string;
/** Config/state directory. Overridable via GEMINISWITCHER_DIR (handy for tests). */
export declare function configDir(): string;
export declare function stateFile(): string;
export declare function defaultSettings(): Settings;
/** Deep-merge user settings over defaults so new defaults apply cleanly. */
export declare function withDefaults(partial?: Partial<Settings>): Settings;
