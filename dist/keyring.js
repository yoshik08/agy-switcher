"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveToken = getActiveToken;
exports.setActiveToken = setActiveToken;
exports.clearActiveToken = clearActiveToken;
exports.getVaultToken = getVaultToken;
exports.setVaultToken = setVaultToken;
exports.deleteVaultToken = deleteVaultToken;
exports.findVaultOwner = findVaultOwner;
/* OS keyring access via keytar.
 *
 * Two namespaces:
 *  - ACTIVE slot: service="gemini", account="antigravity" — the single slot agy reads.
 *  - VAULT:       service="geminiswitcher", account="account:<id>" — one entry per added account.
 *
 * Tokens are treated as opaque strings: whatever agy stored is copied verbatim.
 */
const config_1 = require("./config");
let keytar = null;
let loadError = null;
function lib() {
    if (keytar)
        return keytar;
    if (loadError)
        throw new Error(loadError);
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        keytar = require("keytar");
        return keytar;
    }
    catch (e) {
        loadError =
            "Could not load the OS keyring module (keytar). " +
                "On Linux you may need libsecret / gnome-keyring running; " +
                "reinstall with: npm install -g geminiswitcher. " +
                `Underlying error: ${e.message}`;
        throw new Error(loadError);
    }
}
function friendly(e, what) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Error(`Keyring ${what} failed: ${msg}. ` +
        `On headless Linux, ensure a Secret Service provider (gnome-keyring / kwallet) is available.`);
}
/** Read the token agy is currently using (may be null). */
async function getActiveToken() {
    try {
        return await lib().getPassword(config_1.ACTIVE_SERVICE, config_1.ACTIVE_ACCOUNT);
    }
    catch (e) {
        throw friendly(e, "read (gemini/antigravity)");
    }
}
/** Write a token into the slot agy reads. */
async function setActiveToken(token) {
    try {
        await lib().setPassword(config_1.ACTIVE_SERVICE, config_1.ACTIVE_ACCOUNT, token);
    }
    catch (e) {
        throw friendly(e, "write (gemini/antigravity)");
    }
}
async function clearActiveToken() {
    try {
        await lib().deletePassword(config_1.ACTIVE_SERVICE, config_1.ACTIVE_ACCOUNT);
    }
    catch (e) {
        // deleting a non-existent entry throws on some backends — treat as cleared
        if (!/not found/i.test(e instanceof Error ? e.message : String(e))) {
            throw friendly(e, "clear (gemini/antigravity)");
        }
    }
}
/** Read a stored per-account token from our vault. */
async function getVaultToken(accountId) {
    try {
        return await lib().getPassword(config_1.VAULT_SERVICE, (0, config_1.vaultKey)(accountId));
    }
    catch (e) {
        throw friendly(e, `read (vault ${accountId})`);
    }
}
async function setVaultToken(accountId, token) {
    try {
        await lib().setPassword(config_1.VAULT_SERVICE, (0, config_1.vaultKey)(accountId), token);
    }
    catch (e) {
        throw friendly(e, `write (vault ${accountId})`);
    }
}
async function deleteVaultToken(accountId) {
    try {
        await lib().deletePassword(config_1.VAULT_SERVICE, (0, config_1.vaultKey)(accountId));
    }
    catch (e) {
        if (!/not found/i.test(e instanceof Error ? e.message : String(e))) {
            throw friendly(e, `delete (vault ${accountId})`);
        }
    }
}
/** Find which vault account (if any) already holds this exact token. */
async function findVaultOwner(token, accountIds) {
    for (const id of accountIds) {
        const t = await getVaultToken(id);
        if (t !== null && t === token)
            return id;
    }
    return null;
}
