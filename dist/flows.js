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
exports.switchFlow = switchFlow;
exports.addFlow = addFlow;
exports.writeHandoffFile = writeHandoffFile;
/* Guided flows: account switching and adding.
 * Both take over the screen with a clean panel, run an explicit sequence,
 * and hand the terminal back. Nothing happens invisibly.
 */
const child_process = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const accounts_1 = require("./accounts");
const store_1 = require("./store");
const keyring_1 = require("./keyring");
const ui_1 = require("./ui");
function resumeArgs(state, conversationId) {
    const s = state.settings;
    if (s.preferConversationId && conversationId)
        return ["--conversation", conversationId];
    return s.resumeArgs.length > 0 ? s.resumeArgs : ["-c"];
}
function ask(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (ans) => {
            rl.close();
            resolve(ans);
        });
    });
}
/** Run fn with the terminal in cooked mode (for readline prompts). */
async function cooked(term, fn) {
    const wasRaw = term.isRaw;
    term.exitRaw();
    try {
        return await fn();
    }
    finally {
        if (wasRaw)
            term.enterRaw();
    }
}
function step(text) {
    process.stdout.write(`  ${(0, ui_1.dim)("→")} ${text}\n`);
}
function stepOk(text) {
    process.stdout.write(`  ${(0, ui_1.green)("✓")} ${text}\n`);
}
/* ---------------------------------------------------------- switch flow */
async function switchFlow(ctx, target, reason, signal) {
    const { state, term, pty, router } = ctx;
    router.setMode("blocking");
    const prev = (0, accounts_1.activeAccount)(state);
    const next = target ?? (0, accounts_1.pickNextAccount)(state);
    const title = signal
        ? `${(0, ui_1.yellow)("▲")} limit detected ${(0, ui_1.dim)(`(${signal})`)}`
        : `${(0, ui_1.cyan)("◆")} switching account`;
    term.write((0, ui_1.panel)(title, []));
    if (!next) {
        (0, ui_1.err)(`No other account to switch to. Add one with ${(0, ui_1.cyan)("/add")} — staying on ` +
            (prev ? `"${prev.name}"` : "the current account") + ".");
        router.setMode("agy");
        ctx.refreshStatus();
        return false;
    }
    try {
        step(`from ${prev ? (0, ui_1.accountLabel)(prev) : (0, ui_1.dim)("none")} ${(0, ui_1.dim)("→")} to ${(0, ui_1.accountLabel)(next)} ${(0, ui_1.dim)(`(${reason})`)}`);
        if (state.settings.handoffEnabled) {
            writeHandoffFile(ctx, prev, next, signal ?? reason);
        }
        step("quitting agy…");
        await pty.terminate();
        step("installing token in system keyring…");
        await (0, accounts_1.activate)(state, next, ctx.cwd);
        stepOk(`keyring now serves "${next.name}"`);
        const args = resumeArgs(state, ctx.conversationId());
        step(`relaunching ${(0, ui_1.cyan)(`agy ${args.join(" ")}`)}…`);
        pty.spawn(args, term.cols, term.ptyRows);
        stepOk(`resumed on "${next.name}"`);
        if (state.settings.injectContinuePrompt && state.settings.continuePromptText.trim()) {
            setTimeout(() => pty.write(state.settings.continuePromptText.trim() + "\r"), 1500);
        }
        term.write("\n");
        (0, ui_1.ok)(`Now on ${(0, ui_1.accountLabel)(next)}.`);
    }
    catch (e) {
        (0, ui_1.err)(e instanceof Error ? e.message : String(e));
        // Try to get agy back up even if the switch failed.
        if (!pty.alive) {
            try {
                pty.spawn(resumeArgs(state, ctx.conversationId()), term.cols, term.ptyRows);
                (0, ui_1.warn)("Relaunched agy on the previous account.");
            }
            catch {
                (0, ui_1.err)("Could not relaunch agy. Restart geminiswitcher.");
            }
        }
        router.setMode("agy");
        ctx.refreshStatus();
        return false;
    }
    router.setMode("agy");
    ctx.refreshStatus();
    return true;
}
/* ------------------------------------------------------------- add flow */
async function addFlow(ctx, sessionRunning) {
    const { state, term, pty, router } = ctx;
    router.setMode("blocking");
    term.write((0, ui_1.panel)(`${(0, ui_1.cyan)("◆")} add a google account`, []));
    const prevToken = await (0, keyring_1.getActiveToken)().catch(() => null);
    try {
        if (sessionRunning) {
            const go = await cooked(term, () => ask(`This briefly restarts agy (it will resume). Continue? ${(0, ui_1.dim)("[y/N]")} `));
            if (!/^y(es)?$/i.test(go.trim())) {
                (0, ui_1.info)("Cancelled — agy left running.");
                return;
            }
            step("stopping agy…");
            await pty.terminate();
        }
        const cmd = state.settings.loginCommand;
        step(`Running ${(0, ui_1.cyan)(`agy ${cmd.join(" ")}`)} — complete the Google login in your browser…`);
        term.write((0, ui_1.dim)("  (the login runs in your real terminal, not inside geminiswitcher)\n"));
        // Leave raw mode off for the login's own terminal UI.
        term.exitRaw();
        let loginOk = false;
        let loginErr = "";
        try {
            const res = child_process.spawnSync(state.settings.agyPath, cmd, { stdio: "inherit" });
            if (res.error)
                loginErr = res.error.message;
            else
                loginOk = true;
        }
        catch (e) {
            loginErr = e instanceof Error ? e.message : String(e);
        }
        term.enterRaw();
        if (!loginOk) {
            (0, ui_1.err)(`Could not run ${(0, ui_1.cyan)(`agy ${cmd.join(" ")}`)} (${loginErr || "unknown error"}). ` +
                `Check that agy is installed, or set a custom ${(0, ui_1.cyan)("loginCommand")} in the config.`);
            return;
        }
        const captured = await (0, keyring_1.getActiveToken)().catch(() => null);
        if (!captured) {
            (0, ui_1.err)("Login finished but no credential landed in the keyring. Nothing was stored.");
            if (prevToken)
                await (0, keyring_1.setActiveToken)(prevToken).catch(() => undefined);
            return;
        }
        const dup = await (0, keyring_1.findVaultOwner)(captured, state.accounts.map((a) => a.id)).catch(() => null);
        if (dup) {
            const existing = state.accounts.find((a) => a.id === dup);
            (0, ui_1.warn)(`That Google account is already added as "${existing?.name ?? dup}".`);
            if (prevToken)
                await (0, keyring_1.setActiveToken)(prevToken).catch(() => undefined);
            return;
        }
        const name = await cooked(term, () => ask(`${(0, ui_1.cyan)("Name this account")} (e.g. personal, work): `));
        const account = await (0, accounts_1.registerAccount)(state, name || "account", captured);
        stepOk(`Stored "${account.name}"${account.email ? ` <${account.email}>` : ""} in the OS keyring.`);
        if (state.accounts.length === 1) {
            state.activeAccountId = account.id;
            account.lastUsed = new Date().toISOString();
            (0, store_1.saveState)(state);
            (0, ui_1.ok)(`"${account.name}" is now the active account.`);
        }
        else if (prevToken) {
            await (0, keyring_1.setActiveToken)(prevToken).catch(() => undefined);
            (0, ui_1.info)(`Kept your current account — ${(0, ui_1.cyan)(`/switch ${account.name}`)} to move over.`);
        }
        else {
            // No previous session: activate the new account.
            await (0, accounts_1.activate)(state, account, ctx.cwd);
            (0, ui_1.ok)(`"${account.name}" is now the active account.`);
        }
    }
    finally {
        if (sessionRunning && !pty.alive) {
            step("relaunching agy…");
            pty.spawn(resumeArgs(state, ctx.conversationId()), term.cols, term.ptyRows);
            stepOk("agy is back.");
        }
        router.setMode("agy");
        ctx.refreshStatus();
    }
}
/* --------------------------------------------------------------- handoff */
function writeHandoffFile(ctx, from, to, reason) {
    const file = path.join(ctx.cwd, "handoff.md");
    const tail = ctx
        .recentOutput()
        .slice(-6000)
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[0-9;]*m/g, "");
    const body = [
        "# geminiswitcher handoff",
        "",
        `- when: ${new Date().toISOString()}`,
        `- from: ${from ? `${from.name}${from.email ? ` <${from.email}>` : ""}` : "unknown"}`,
        `- to: ${to.name}${to.email ? ` <${to.email}>` : ""}`,
        `- reason: ${reason}`,
        `- conversation: ${ctx.conversationId() ?? "not captured"}`,
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
    (0, ui_1.ok)(`Wrote ${(0, ui_1.cyan)("handoff.md")} ${(0, ui_1.dim)("(opt-in snapshot)")} → ${file}`);
    return file;
}
