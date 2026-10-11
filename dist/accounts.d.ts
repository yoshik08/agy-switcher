import { Account, State } from "./types";
export declare function slugify(name: string): string;
export declare function newAccountId(name: string): string;
export declare function getAccount(state: State, id: string): Account | undefined;
export declare function activeAccount(state: State): Account | null;
export declare function findAccounts(state: State, query: string): Account[];
/**
 * Make `account` the active one: copy its vault token into the agy keyring slot.
 */
export declare function activate(state: State, account: Account, dir?: string): Promise<void>;
export declare function removeAccount(state: State, account: Account): Promise<void>;
export declare function registerAccount(state: State, name: string, token: string): Promise<Account>;
/** Least-recently-used account excluding the current one. */
export declare function pickNextAccount(state: State): Account | null;
/** Account remembered for a directory, if it still exists. */
export declare function dirAccount(state: State, dir: string): Account | null;
/** Ensure the active slot holds the active account's token (repairs drift). */
export declare function ensureActiveSlot(state: State): Promise<void>;
