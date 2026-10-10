/* OS keyring access via keytar.
 *
 * Two namespaces:
 *  - ACTIVE slot: service="gemini", account="antigravity" — the single slot agy reads.
 *  - VAULT:       service="geminiswitcher", account="account:<id>" — one entry per added account.
 *
 * Tokens are treated as opaque strings: whatever agy stored is copied verbatim.
 */
import { ACTIVE_ACCOUNT, ACTIVE_SERVICE, VAULT_SERVICE, vaultKey } from "./config";

let keytar: typeof import("keytar") | null = null;
let loadError: string | null = null;

function lib(): typeof import("keytar") {
  if (keytar) return keytar;
  if (loadError) throw new Error(loadError);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    keytar = require("keytar") as typeof import("keytar");
    return keytar;
  } catch (e) {
    loadError =
      "Could not load the OS keyring module (keytar). " +
      "On Linux you may need libsecret / gnome-keyring running; " +
      "reinstall with: npm install -g geminiswitcher. " +
      `Underlying error: ${(e as Error).message}`;
    throw new Error(loadError);
  }
}

function friendly(e: unknown, what: string): Error {
  const msg = e instanceof Error ? e.message : String(e);
  return new Error(
    `Keyring ${what} failed: ${msg}. ` +
      `On headless Linux, ensure a Secret Service provider (gnome-keyring / kwallet) is available.`
  );
}

/** Read the token agy is currently using (may be null). */
export async function getActiveToken(): Promise<string | null> {
  try {
    return await lib().getPassword(ACTIVE_SERVICE, ACTIVE_ACCOUNT);
  } catch (e) {
    throw friendly(e, "read (gemini/antigravity)");
  }
}

/** Write a token into the slot agy reads. */
export async function setActiveToken(token: string): Promise<void> {
  try {
    await lib().setPassword(ACTIVE_SERVICE, ACTIVE_ACCOUNT, token);
  } catch (e) {
    throw friendly(e, "write (gemini/antigravity)");
  }
}

export async function clearActiveToken(): Promise<void> {
  try {
    await lib().deletePassword(ACTIVE_SERVICE, ACTIVE_ACCOUNT);
  } catch (e) {
    // deleting a non-existent entry throws on some backends — treat as cleared
    if (!/not found/i.test(e instanceof Error ? e.message : String(e))) {
      throw friendly(e, "clear (gemini/antigravity)");
    }
  }
}

/** Read a stored per-account token from our vault. */
export async function getVaultToken(accountId: string): Promise<string | null> {
  try {
    return await lib().getPassword(VAULT_SERVICE, vaultKey(accountId));
  } catch (e) {
    throw friendly(e, `read (vault ${accountId})`);
  }
}

export async function setVaultToken(accountId: string, token: string): Promise<void> {
  try {
    await lib().setPassword(VAULT_SERVICE, vaultKey(accountId), token);
  } catch (e) {
    throw friendly(e, `write (vault ${accountId})`);
  }
}

export async function deleteVaultToken(accountId: string): Promise<void> {
  try {
    await lib().deletePassword(VAULT_SERVICE, vaultKey(accountId));
  } catch (e) {
    if (!/not found/i.test(e instanceof Error ? e.message : String(e))) {
      throw friendly(e, `delete (vault ${accountId})`);
    }
  }
}

/** Find which vault account (if any) already holds this exact token. */
export async function findVaultOwner(
  token: string,
  accountIds: string[]
): Promise<string | null> {
  for (const id of accountIds) {
    const t = await getVaultToken(id);
    if (t !== null && t === token) return id;
  }
  return null;
}
