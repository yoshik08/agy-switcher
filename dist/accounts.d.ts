import { Account, State } from "./types";
export declare function slugify(name: string): string;
export declare function newAccountId(name: string): string;
export declare function getAccount(state: State, id: string): Account | undefined;
export declare function activeAccount(state: State): Account | null;
/** Fuzzy find by name, email, or id prefix. Returns matches. */
export declare function findAccounts(state: State, query: string): Account[];
/**
 * Make `account` the active one: copy its vault token into the agy keyring slot.
 * Throws with a clear message if anything goes wrong (caller decides UX).
 */
export declare function activate(state: State, account: Account): Promise<void>;
/** Remove an account entirely (metadata + vault token). Active account cannot be removed. */
export declare function removeAccount(state: State, account: Account): Promise<void>;
/**
 * Register a freshly-captured token as a new account.
 * Returns the created account. Does NOT activate it (caller decides).
 */
export declare function registerAccount(state: State, name: string, token: string): Promise<Account>;
/** Pick the next account for autoswitch: least-recently-used, excluding current. */
export declare function pickNextAccount(state: State): Account | null;
/** Ensure the active slot holds the active account's token (repairs drift). */
export declare function ensureActiveSlot(state: State): Promise<void>;
