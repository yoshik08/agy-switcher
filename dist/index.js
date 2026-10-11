#!/usr/bin/env node
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
/* geminiswitcher v2 — claude-code-style home for the Antigravity CLI (agy).
 *
 * Usage:
 *   geminiswitcher [options] [-- agy-args...]
 *
 * Options:
 *   --help, -h        Show help
 *   --version, -v     Show version
 *   --add             Add an account (agy auth login) and exit
 *   --agy-path <bin>  Override the agy binary
 *
 * Everything else is forwarded to agy on every launch.
 */
const config_1 = require("./config");
const store_1 = require("./store");
const accounts_1 = require("./accounts");
const keyring_1 = require("./keyring");
const app_1 = require("./app");
const ui_1 = require("./ui");
const readline = __importStar(require("readline"));
function parseArgs(argv) {
    const opts = { help: false, version: false, addOnly: false, agyPath: null, agyArgs: [] };
    let i = 0;
    let passthrough = false;
    while (i < argv.length) {
        const a = argv[i];
        if (passthrough) {
            opts.agyArgs.push(a);
            i++;
            continue;
        }
        if (a === "--") {
            passthrough = true;
            i++;
            continue;
        }
        if (a === "--help" || a === "-h")
            opts.help = true;
        else if (a === "--version" || a === "-v")
            opts.version = true;
        else if (a === "--add")
            opts.addOnly = true;
        else if (a === "--agy-path") {
            i++;
            if (i >= argv.length)
                throw new Error("--agy-path needs a value");
            opts.agyPath = argv[i];
        }
        else {
            opts.agyArgs.push(a);
        }
        i++;
    }
    return opts;
}
function printUsage() {
    process.stdout.write([
        (0, ui_1.bold)(`geminiswitcher v${config_1.VERSION}`),
        (0, ui_1.dim)("claude-code-style home for the antigravity cli"),
        "",
        `Usage: ${(0, ui_1.cyan)("geminiswitcher")} [options] [-- agy-args...]`,
        "",
        "Options:",
        "  --help, -h       Show this help",
        "  --version, -v    Show version",
        "  --add            Add an account and exit (no session)",
        "  --agy-path <bin> Use a different agy binary",
        "",
        "All other arguments are forwarded to agy on every launch.",
        "",
        "Inside: press / or ctrl+g for the command palette.",
        "",
    ].join("\n"));
}
/** Headless /add for --add and first-run (no application session). */
async function headlessAdd() {
    const { loadState: ls, saveState: ss } = await Promise.resolve().then(() => __importStar(require("./store")));
    const state = ls();
    const prevToken = await (0, keyring_1.getActiveToken)().catch(() => null);
    const cmd = state.settings.loginCommand;
    (0, ui_1.info)(`Running ${(0, ui_1.cyan)(`agy ${cmd.join(" ")}`)} — complete the Google login in your browser…`);
    const { spawnSync } = await Promise.resolve().then(() => __importStar(require("child_process")));
    const res = spawnSync(state.settings.agyPath, cmd, { stdio: "inherit" });
    if (res.error) {
        (0, ui_1.err)(`Could not run agy ${cmd.join(" ")}: ${res.error.message}`);
        return false;
    }
    const captured = await (0, keyring_1.getActiveToken)().catch(() => null);
    if (!captured) {
        (0, ui_1.err)("Login finished but no credential landed in the keyring. Nothing was stored.");
        if (prevToken)
            await (0, keyring_1.setActiveToken)(prevToken).catch(() => undefined);
        return false;
    }
    const dup = await (0, keyring_1.findVaultOwner)(captured, state.accounts.map((a) => a.id)).catch(() => null);
    if (dup) {
        const existing = state.accounts.find((a) => a.id === dup);
        (0, ui_1.err)(`That Google account is already added as "${existing?.name ?? dup}".`);
        if (prevToken)
            await (0, keyring_1.setActiveToken)(prevToken).catch(() => undefined);
        return false;
    }
    const name = await new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`${(0, ui_1.cyan)("Name this account")} (e.g. personal, work): `, (ans) => {
            rl.close();
            resolve(ans);
        });
    });
    const account = await (0, accounts_1.registerAccount)(state, name || "account", captured);
    (0, ui_1.ok)(`Stored "${account.name}"${account.email ? ` <${account.email}>` : ""} in the OS keyring.`);
    if (!state.activeAccountId) {
        state.activeAccountId = account.id;
        account.lastUsed = new Date().toISOString();
        ss(state);
        (0, ui_1.ok)(`"${account.name}" is now the active account.`);
    }
    else if (prevToken) {
        await (0, keyring_1.setActiveToken)(prevToken).catch(() => undefined);
    }
    return true;
}
async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        printUsage();
        process.stdout.write(ui_1.HELP_TEXT + "\n");
        return;
    }
    if (opts.version) {
        process.stdout.write(`geminiswitcher ${config_1.VERSION}\n`);
        return;
    }
    const state = (0, store_1.loadState)();
    if (opts.agyPath)
        state.settings.agyPath = opts.agyPath;
    (0, store_1.saveState)(state);
    if (opts.addOnly) {
        const okAdded = await headlessAdd();
        process.exitCode = okAdded ? 0 : 1;
        return;
    }
    if (state.accounts.length === 0) {
        (0, ui_1.banner)(config_1.VERSION);
        (0, ui_1.info)("No accounts yet — let's connect your first Google account.");
        (0, ui_1.info)((0, ui_1.dim)(`This runs ${(0, ui_1.cyan)("agy auth login")} and stores the result securely.`));
        const okAdded = await headlessAdd();
        if (!okAdded || (0, store_1.loadState)().accounts.length === 0) {
            (0, ui_1.err)("No accounts configured. Run with --add to try again.");
            process.exitCode = 1;
            return;
        }
    }
    const fresh = (0, store_1.loadState)();
    if (opts.agyPath)
        fresh.settings.agyPath = opts.agyPath;
    const acct = (0, accounts_1.activeAccount)(fresh);
    if (!acct) {
        (0, ui_1.err)("No active account is set. This is a bug — please report it.");
        process.exitCode = 1;
        return;
    }
    const app = new app_1.Application(fresh, opts.agyArgs, process.cwd());
    await app.run();
}
main().catch((e) => {
    try {
        if (process.stdin.isTTY)
            process.stdin.setRawMode(false);
        process.stdout.write("\x1b[r");
    }
    catch {
        /* ignore */
    }
    process.stderr.write(`geminiswitcher: fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
});
