/* Account management: metadata in state.json, tokens in the OS keyring vault. */
import * as crypto from "crypto";
import { Account, State } from "./types";
import { saveState } from "./store";
import { extractEmail } from "./detect";
import {
  deleteVaultToken,
  getActiveToken,
  getVaultToken,
  setActiveToken,
  setVaultToken,
} from "./keyring";
import { err, ok } from "./ui";

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return s || "account";
}

export function newAccountId(name: string): string {
  return `${slugify(name)}-${crypto.randomBytes(3).toString("hex")}`;
}

export function getAccount(state: State, id: string): Account | undefined {
  return state.accounts.find((a) => a.id === id);
}

export function activeAccount(state: State): Account | null {
  if (!state.activeAccountId) return null;
  return getAccount(state, state.activeAccountId) ?? null;
}

/** Fuzzy find by name, email, or id prefix. Returns matches. */
export function findAccounts(state: State, query: string): Account[] {
  const q = query.toLowerCase();
  return state.accounts.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      (a.email ?? "").toLowerCase().includes(q) ||
      a.id.toLowerCase().startsWith(q)
  );
}

/**
 * Make `account` the active one: copy its vault token into the agy keyring slot.
 * Throws with a clear message if anything goes wrong (caller decides UX).
 */
export async function activate(state: State, account: Account): Promise<void> {
  const token = await getVaultToken(account.id);
  if (!token) {
    throw new Error(
      `No stored credential for "${account.name}" in the OS keyring vault. ` +
        `Re-add it with /add.`
    );
  }
  await setActiveToken(token);
  account.lastUsed = new Date().toISOString();
  state.activeAccountId = account.id;
  saveState(state);
}

/** Remove an account entirely (metadata + vault token). Active account cannot be removed. */
export async function removeAccount(state: State, account: Account): Promise<void> {
  if (state.activeAccountId === account.id) {
    throw new Error(`"${account.name}" is the active account — /switch away from it first.`);
  }
  await deleteVaultToken(account.id);
  state.accounts = state.accounts.filter((a) => a.id !== account.id);
  saveState(state);
}

/**
 * Register a freshly-captured token as a new account.
 * Returns the created account. Does NOT activate it (caller decides).
 */
export async function registerAccount(
  state: State,
  name: string,
  token: string
): Promise<Account> {
  const now = new Date().toISOString();
  const account: Account = {
    id: newAccountId(name),
    name: name.trim() || "account",
    email: extractEmail(token),
    plan: null,
    addedAt: now,
    lastUsed: null,
    lastQuota: null,
  };
  await setVaultToken(account.id, token);
  state.accounts.push(account);
  saveState(state);
  return account;
}

/** Pick the next account for autoswitch: least-recently-used, excluding current. */
export function pickNextAccount(state: State): Account | null {
  const current = state.activeAccountId;
  const others = state.accounts.filter((a) => a.id !== current);
  if (others.length === 0) return null;
  others.sort((a, b) => {
    const ta = a.lastUsed ?? a.addedAt;
    const tb = b.lastUsed ?? b.addedAt;
    return ta.localeCompare(tb);
  });
  return others[0];
}

/** Ensure the active slot holds the active account's token (repairs drift). */
export async function ensureActiveSlot(state: State): Promise<void> {
  const acct = activeAccount(state);
  if (!acct) return;
  const vault = await getVaultToken(acct.id);
  if (!vault) {
    err(`Stored credential for "${acct.name}" is missing from the keyring vault.`);
    return;
  }
  const slot = await getActiveToken();
  if (slot !== vault) {
    await setActiveToken(vault);
    ok(`Keyring slot refreshed for "${acct.name}".`);
  }
}
