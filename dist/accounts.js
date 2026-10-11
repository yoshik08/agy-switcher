"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugify = slugify;
exports.newAccountId = newAccountId;
exports.getAccount = getAccount;
exports.activeAccount = activeAccount;
exports.findAccounts = findAccounts;
exports.activate = activate;
exports.removeAccount = removeAccount;
exports.registerAccount = registerAccount;
exports.pickNextAccount = pickNextAccount;
exports.dirAccount = dirAccount;
exports.ensureActiveSlot = ensureActiveSlot;
/* Account management: metadata in state.json, tokens in the OS keyring vault,
 * plus per-directory account memory.
 */
const crypto = __importStar(require("crypto"));
const store_1 = require("./store");
const keyring_1 = require("./keyring");
const ui_1 = require("./ui");
function slugify(name) {
    const s = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24);
    return s || "account";
}
function newAccountId(name) {
    return `${slugify(name)}-${crypto.randomBytes(3).toString("hex")}`;
}
function getAccount(state, id) {
    return state.accounts.find((a) => a.id === id);
}
function activeAccount(state) {
    if (!state.activeAccountId)
        return null;
    return getAccount(state, state.activeAccountId) ?? null;
}
function findAccounts(state, query) {
    const q = query.toLowerCase();
    return state.accounts.filter((a) => a.name.toLowerCase().includes(q) ||
        (a.email ?? "").toLowerCase().includes(q) ||
        a.id.toLowerCase().startsWith(q));
}
/**
 * Make `account` the active one: copy its vault token into the agy keyring slot.
 */
async function activate(state, account, dir) {
    const token = await (0, keyring_1.getVaultToken)(account.id);
    if (!token) {
        throw new Error(`No stored credential for "${account.name}" in the OS keyring vault. Re-add it with /add.`);
    }
    await (0, keyring_1.setActiveToken)(token);
    account.lastUsed = new Date().toISOString();
    state.activeAccountId = account.id;
    if (dir && state.settings.rememberDirAccount) {
        state.dirPrefs[dir] = { accountId: account.id, updatedAt: new Date().toISOString() };
    }
    (0, store_1.saveState)(state);
}
async function removeAccount(state, account) {
    if (state.activeAccountId === account.id) {
        throw new Error(`"${account.name}" is the active account — /switch away from it first.`);
    }
    await (0, keyring_1.deleteVaultToken)(account.id);
    state.accounts = state.accounts.filter((a) => a.id !== account.id);
    (0, store_1.saveState)(state);
}
async function registerAccount(state, name, token) {
    const now = new Date().toISOString();
    const account = {
        id: newAccountId(name),
        name: name.trim() || "account",
        email: extractEmail(token),
        plan: null,
        addedAt: now,
        lastUsed: null,
        lastQuota: null,
    };
    await (0, keyring_1.setVaultToken)(account.id, token);
    state.accounts.push(account);
    (0, store_1.saveState)(state);
    return account;
}
/** Least-recently-used account excluding the current one. */
function pickNextAccount(state) {
    const current = state.activeAccountId;
    const others = state.accounts.filter((a) => a.id !== current);
    if (others.length === 0)
        return null;
    others.sort((a, b) => {
        const ta = a.lastUsed ?? a.addedAt;
        const tb = b.lastUsed ?? b.addedAt;
        return ta.localeCompare(tb);
    });
    return others[0];
}
/** Account remembered for a directory, if it still exists. */
function dirAccount(state, dir) {
    if (!state.settings.rememberDirAccount)
        return null;
    const pref = state.dirPrefs[dir];
    if (!pref)
        return null;
    return getAccount(state, pref.accountId) ?? null;
}
/** Ensure the active slot holds the active account's token (repairs drift). */
async function ensureActiveSlot(state) {
    const acct = activeAccount(state);
    if (!acct)
        return;
    const vault = await (0, keyring_1.getVaultToken)(acct.id);
    if (!vault) {
        (0, ui_1.err)(`Stored credential for "${acct.name}" is missing from the keyring vault.`);
        return;
    }
    const slot = await (0, keyring_1.getActiveToken)();
    if (slot !== vault) {
        await (0, keyring_1.setActiveToken)(vault);
        (0, ui_1.ok)(`Keyring slot refreshed for "${acct.name}".`);
    }
}
function extractEmail(token) {
    const t = token.trim();
    if (t.startsWith("{")) {
        try {
            const obj = JSON.parse(t);
            const candidates = [
                obj.email,
                obj.user_email,
                obj.user?.email,
                obj.profile?.email,
            ];
            for (const c of candidates) {
                if (typeof c === "string" && c.includes("@"))
                    return c;
            }
        }
        catch {
            /* not JSON */
        }
    }
    const parts = t.split(".");
    if (parts.length === 3) {
        try {
            const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
            if (typeof payload.email === "string" && payload.email.includes("@"))
                return payload.email;
        }
        catch {
            /* not a JWT */
        }
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t))
        return t;
    return null;
}
