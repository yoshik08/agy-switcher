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
exports.switchToAccount = switchToAccount;
exports.handleLimit = handleLimit;
exports.writeHandoff = writeHandoff;
exports.addAccountFlow = addAccountFlow;
/* Orchestration: account switching, limit handling, /add flow, handoff.md.
 *
 * Core principle: a running agy holds its keyring token in memory, so every
 * credential swap follows the same sequence:
 *   1. quit the agy process
 *   2. write the next account's token into the keyring (service=gemini, account=antigravity)
 *   3. relaunch agy with resume args (agy -c, or --conversation <id>)
 */
const child_process = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const accounts_1 = require("./accounts");
const store_1 = require("./store");
const keyring_1 = require("./keyring");
const ui_1 = require("./ui");
function relaunchArgs(state, conversationId) {
    const s = state.settings;
    if (s.preferConversationId && conversationId) {
        return ["--conversation", conversationId];
    }
    return s.resumeArgs.length > 0 ? s.resumeArgs : ["-c"];
}
function fmtAccount(a) {
    const email = a.email ? (0, ui_1.dim)(` <${a.email}>`) : "";
    const plan = a.plan ? (0, ui_1.dim)(` · ${a.plan}`) : "";
    return `${(0, ui_1.bold)(a.name)}${email}${plan}`;
}
/** Switch to `next` (token swap + relaunch). Caller must have stopped agy already. */
async function switchToAccount(session, state, next, reason) {
    const prev = (0, accounts_1.activeAccount)(state);
    (0, ui_1.info)(`Switching accounts (${reason}): ${prev ? prev.name : "none"} → ${fmtAccount(next)}`);
    await (0, accounts_1.activate)(state, next);
    (0, ui_1.ok)(`Token swapped into system keyring for "${next.name}".`);
    const args = relaunchArgs(state, session.conversationId);
    (0, ui_1.info)(`Relaunching ${(0, ui_1.cyan)(`agy ${args.join(" ")}`)} in ${(0, ui_1.dim)(session.cwd)} …`);
    session.busy = true;
    try {
        await session.restart(args);
    }
    finally {
        session.busy = false;
    }
    (0, ui_1.ok)(`Resumed on "${next.name}".`);
    const s = state.settings;
    if (s.injectContinuePrompt && s.continuePromptText.trim()) {
        setTimeout(() => {
            session.sendToAgy(s.continuePromptText.trim() + "\r");
        }, 1500);
    }
}
/** Handle a detected limit signal. The big autoswitch decision point. */
async function handleLimit(session, state, signal) {
    const acct = (0, accounts_1.activeAccount)(state);
    const who = acct ? `"${acct.name}"` : "current account";
    if (!state.settings.autoswitch) {
        // Explicitly: nothing automatic. No switch, no handoff.md — ever.
        (0, ui_1.warn)(`Limit signal on ${who} (${signal.signal}) — autoswitch is ${(0, ui_1.yellow)("OFF")}. ` +
            `Staying put. Use ${(0, ui_1.cyan)("/switch <name>")} to change accounts manually.`);
        return;
    }
    if (signal.kind === "soft") {
        (0, ui_1.info)(`Heads up: ${who} is approaching its limit (${signal.signal}). Will autoswitch on hard limit.`);
        return;
    }
    const next = (0, accounts_1.pickNextAccount)(state);
    if (!next) {
        (0, ui_1.err)(`Hard limit on ${who} (${signal.signal}) but no other accounts are configured. ` +
            `Add one with ${(0, ui_1.cyan)("/add")} — staying on ${who}.`);
        return;
    }
    process.stdout.write("\n");
    (0, ui_1.warn)(`Limit detected on ${who} (${(0, ui_1.red)(signal.signal)}). Autoswitch is ON.`);
    if (state.settings.handoffEnabled) {
        writeHandoff(state, session, acct, next, signal.signal);
    }
    await switchToAccount(session, state, next, `limit on ${who}`);
}
/** Minimal optional handoff snapshot. Only ever written when explicitly enabled. */
function writeHandoff(state, session, from, to, signal) {
    const file = path.join(session.cwd, "handoff.md");
    const tail = session.recentOutput.slice(-6000).replace(/\x1b\[[0-9;]*m/g, "");
    const body = [
        "# geminiswitcher handoff",
        "",
        `- when: ${new Date().toISOString()}`,
        `- from: ${from ? `${from.name}${from.email ? ` <${from.email}>` : ""}` : "unknown"}`,
        `- to: ${to.name}${to.email ? ` <${to.email}>` : ""}`,
        `- trigger: ${signal}`,
        `- conversation: ${session.conversationId ?? "not captured"}`,
        "- resume: run `geminiswitcher` (it relaunches `agy -c`)",
        "",
        "## recent output tail (may be incomplete)",
        "",
        "```",
        tail.trim().slice(-4000),
        "```",
        "",
    ].join("\n");
    fs.writeFileSync(file, body);
    (0, ui_1.ok)(`Wrote minimal ${(0, ui_1.cyan)("handoff.md")} (enabled via config).`);
    return file;
}
/** Ask a y/n question while the terminal is in cooked mode. */
function askYesNo(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`${question} ${(0, ui_1.dim)("[y/N]")} `, (ans) => {
            rl.close();
            resolve(/^y(es)?$/i.test(ans.trim()));
        });
    });
}
function askLine(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (ans) => {
            rl.close();
            resolve(ans);
        });
    });
}
/**
 * /add flow: drive agy's own login in the real terminal, capture whatever
 * token agy stored in the keyring, and vault it under a new account.
 * If a session is active it is briefly stopped (then relaunched with resume).
 */
async function addAccountFlow(session, state) {
    const prevToken = await (0, keyring_1.getActiveToken)().catch(() => null);
    let suspended = false;
    try {
        if (session) {
            (0, ui_1.info)("Adding an account briefly stops agy (it will resume afterwards).");
            const go = await withCooked(() => askYesNo("Continue with /add?"));
            if (!go) {
                (0, ui_1.info)("Cancelled — agy left running.");
                return;
            }
            session.detach();
            await session.stopChild();
            suspended = true;
        }
        const agyPath = state.settings.agyPath;
        let loginOk = false;
        let loginErr = "";
        for (const cmd of state.settings.loginCommands) {
            (0, ui_1.info)(`Running ${(0, ui_1.cyan)(`agy ${cmd.join(" ")}`)} — complete the Google login in your browser…`);
            try {
                const res = child_process.spawnSync(agyPath, cmd, { stdio: "inherit" });
                if (res.error) {
                    loginErr = res.error.message;
                    continue;
                }
                loginOk = true;
                break;
            }
            catch (e) {
                loginErr = e instanceof Error ? e.message : String(e);
            }
        }
        if (!loginOk) {
            (0, ui_1.err)(`Could not run agy's login flow (${loginErr || "unknown error"}). ` +
                `Set a custom command via the ${(0, ui_1.cyan)("loginCommands")} setting (see README).`);
            return;
        }
        const captured = await (0, keyring_1.getActiveToken)().catch(() => null);
        if (!captured) {
            (0, ui_1.err)("Login finished but no credential was captured from the keyring. Nothing was stored.");
            if (prevToken)
                await (0, keyring_1.setActiveToken)(prevToken).catch(() => undefined);
            return;
        }
        const existingId = await (0, keyring_1.findVaultOwner)(captured, state.accounts.map((a) => a.id)).catch(() => null);
        if (existingId) {
            const dup = state.accounts.find((a) => a.id === existingId);
            (0, ui_1.warn)(`That Google account is already added as "${dup?.name ?? existingId}".`);
            if (prevToken)
                await (0, keyring_1.setActiveToken)(prevToken).catch(() => undefined);
            return;
        }
        const name = await askLine(`${(0, ui_1.cyan)("Name this account")} (e.g. personal, work): `);
        const account = await (0, accounts_1.registerAccount)(state, name || "account", captured);
        (0, ui_1.ok)(`Stored "${account.name}"${account.email ? ` <${account.email}>` : ""} securely in the OS keyring.`);
        if (state.accounts.length === 1) {
            // First account becomes active and stays in the slot.
            state.activeAccountId = account.id;
            account.lastUsed = new Date().toISOString();
            (0, store_1.saveState)(state);
            (0, ui_1.ok)(`"${account.name}" is now the active account.`);
        }
        else if (prevToken) {
            // Restore whoever was active before, so /add doesn't yank the session sideways.
            await (0, keyring_1.setActiveToken)(prevToken).catch(() => undefined);
            (0, ui_1.info)(`Kept your current account active — use ${(0, ui_1.cyan)(`/switch ${account.name}`)} to move over.`);
        }
    }
    finally {
        if (session && suspended) {
            session.attach();
            session.launch(relaunchArgs(state, session.conversationId));
            (0, ui_1.ok)("agy relaunched.");
        }
    }
}
/** Run a function with the terminal in cooked mode (for readline prompts). */
async function withCooked(fn) {
    const wasRaw = !!(process.stdin.isTTY && process.stdin.isRaw);
    try {
        if (process.stdin.isTTY)
            process.stdin.setRawMode(false);
        return await fn();
    }
    finally {
        if (wasRaw && process.stdin.isTTY)
            process.stdin.setRawMode(true);
    }
}
