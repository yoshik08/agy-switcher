#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* geminiswitcher — multi-account wrapper for the Antigravity CLI (agy).
 *
 * Usage:
 *   geminiswitcher [options] [-- agy-args...]
 *
 * Options:
 *   --help, -h        Show help
 *   --version, -v     Show version
 *   --add             Add an account (drives agy's login) and exit
 *   --agy-path <bin>  Override the agy binary
 *
 * Everything else is forwarded to agy on every launch.
 */
const config_1 = require("./config");
const store_1 = require("./store");
const accounts_1 = require("./accounts");
const session_1 = require("./session");
const commands_1 = require("./commands");
const orchestrate_1 = require("./orchestrate");
const ui_1 = require("./ui");
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
            // Unknown flags and positionals belong to agy.
            opts.agyArgs.push(a);
        }
        i++;
    }
    return opts;
}
function printUsage() {
    process.stdout.write([
        (0, ui_1.bold)(`geminiswitcher v${config_1.VERSION}`),
        (0, ui_1.dim)("multi-account wrapper for the Antigravity CLI (agy)"),
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
        `Example: ${(0, ui_1.cyan)("geminiswitcher -- --model foo")}  (passes --model foo to agy)`,
        "",
        "Inside a session, slash commands are intercepted:",
        "  /add  /accounts  /usage  /switch <name>  /autoswitch-on  /autoswitch-off  /help",
        "",
    ].join("\n"));
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
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        (0, ui_1.err)("geminiswitcher needs an interactive terminal.");
        process.exitCode = 1;
        return;
    }
    const state = (0, store_1.loadState)();
    if (opts.agyPath)
        state.settings.agyPath = opts.agyPath;
    (0, store_1.saveState)(state);
    if (opts.addOnly) {
        await (0, orchestrate_1.addAccountFlow)(null, state);
        return;
    }
    // First run: no accounts yet → walk through /add, then continue into a session.
    if (state.accounts.length === 0) {
        (0, ui_1.banner)(config_1.VERSION);
        (0, ui_1.info)("No accounts yet. Let's add your first Google account.");
        await (0, orchestrate_1.addAccountFlow)(null, state);
        if (state.accounts.length === 0) {
            (0, ui_1.err)("No accounts configured — quitting. Run with --add to try again.");
            process.exitCode = 1;
            return;
        }
    }
    const acct = (0, accounts_1.activeAccount)(state);
    if (!acct) {
        (0, ui_1.err)("No active account is set. This is a bug — please report it.");
        process.exitCode = 1;
        return;
    }
    // Make sure the keyring slot agy reads holds the active account's token.
    try {
        await (0, accounts_1.ensureActiveSlot)(state);
    }
    catch (e) {
        (0, ui_1.err)(e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
        return;
    }
    (0, ui_1.banner)(config_1.VERSION);
    const planBit = acct.plan ? ` · ${acct.plan}` : "";
    const emailBit = acct.email ? ` <${acct.email}>` : "";
    (0, ui_1.info)(`Account: ${(0, ui_1.bold)(acct.name)}${(0, ui_1.dim)(emailBit)}${(0, ui_1.dim)(planBit)}   Autoswitch: ${state.settings.autoswitch ? (0, ui_1.bold)("ON") : (0, ui_1.dim)("OFF")}`);
    (0, ui_1.info)(`Type ${(0, ui_1.cyan)("/help")} inside the session for commands. Launching agy…`);
    process.stdout.write("\n");
    const cwd = process.cwd();
    let resolveDone;
    const sessionDone = new Promise((r) => {
        resolveDone = r;
    });
    const session = new session_1.Session(state, state.settings.agyPath, opts.agyArgs, cwd, {
        onSlash: async (cmd, args) => {
            await (0, commands_1.handleSlashCommand)(cmd, args, {
                session,
                state,
                quit: async () => {
                    await session.end();
                    resolveDone();
                },
            });
        },
        onLimit: async (signal) => {
            await (0, orchestrate_1.handleLimit)(session, state, signal);
        },
        onEnd: async (code) => {
            process.stdout.write("\n");
            (0, ui_1.info)(`agy exited (code ${code}). Session over — run ${(0, ui_1.cyan)("geminiswitcher")} to start again.`);
            resolveDone();
        },
    });
    session.attach();
    try {
        session.launch([]);
    }
    catch (e) {
        await session.end();
        (0, ui_1.err)(`Could not launch "${state.settings.agyPath}": ${e instanceof Error ? e.message : String(e)}. Is agy installed and on your PATH? Override with --agy-path.`);
        process.exitCode = 1;
        return;
    }
    // Resolves when agy exits on its own (restarts don't resolve it).
    await sessionDone;
    try {
        await session.end();
    }
    catch {
        /* ignore */
    }
    (0, ui_1.ok)("Bye.");
}
main().catch((e) => {
    try {
        if (process.stdin.isTTY)
            process.stdin.setRawMode(false);
    }
    catch {
        /* ignore */
    }
    process.stderr.write(`geminiswitcher: fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
});
