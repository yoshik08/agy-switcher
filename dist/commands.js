"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommand = runCommand;
exports.commandRegistry = commandRegistry;
const accounts_1 = require("./accounts");
const ui_1 = require("./ui");
function accountsTable(state) {
    const activeId = state.activeAccountId;
    const rows = state.accounts.map((a) => [
        (a.id === activeId ? (0, ui_1.green)("● ") : "  ") + a.name,
        a.email ?? (0, ui_1.dim)("unknown"),
        a.plan ?? (0, ui_1.dim)("unknown"),
        a.lastQuota ? `${a.lastQuota.text} ${(0, ui_1.dim)(`(${(0, ui_1.relTime)(a.lastQuota.at)})`)}` : (0, ui_1.dim)("not seen yet"),
        (0, ui_1.relTime)(a.lastUsed),
    ]);
    if (rows.length === 0) {
        (0, ui_1.warn)(`No accounts yet. Run ${(0, ui_1.cyan)("/add")} to connect your first Google account.`);
        return;
    }
    (0, ui_1.table)(["account", "email", "plan", "quota", "last used"], rows);
}
async function cmdAdd(env) {
    await env.addAccount();
}
async function cmdAccounts(env) {
    accountsTable(env.state);
}
async function cmdUsage(env) {
    (0, ui_1.info)((0, ui_1.bold)("Remaining usage (observed from agy's own output):"));
    accountsTable(env.state);
    if (env.state.settings.forwardUsageToAgy) {
        (0, ui_1.info)((0, ui_1.dim)("Asking agy for the live current-account figure…"));
        env.forwardToAgy("/usage\r");
    }
}
async function cmdSwitch(env, args) {
    const { state } = env;
    const query = args.join(" ").trim();
    if (!query) {
        (0, ui_1.err)(`Usage: ${(0, ui_1.cyan)("/switch <name>")} — pick from:`);
        accountsTable(state);
        return;
    }
    const matches = (0, accounts_1.findAccounts)(state, query);
    if (matches.length === 0) {
        (0, ui_1.err)(`No account matches "${query}".`);
        accountsTable(state);
        return;
    }
    if (matches.length > 1) {
        (0, ui_1.err)(`"${query}" matches: ${matches.map((m) => m.name).join(", ")}. Be more specific (tab completes).`);
        return;
    }
    const target = matches[0];
    if (target.id === state.activeAccountId) {
        (0, ui_1.info)(`"${target.name}" is already active.`);
        return;
    }
    await env.switchTo(target, "manual /switch");
}
async function cmdAutoswitch(env, on) {
    env.setAutoswitch(on);
    if (on) {
        (0, ui_1.ok)(`Autoswitch ${(0, ui_1.green)("on")} — hard limits will trigger a switch + resume.`);
    }
    else {
        (0, ui_1.ok)(`Autoswitch ${(0, ui_1.yellow)("off")} — nothing automatic from here on. No switches, ` +
            `and ${(0, ui_1.bold)("no handoff.md will ever be written")}. ${(0, ui_1.cyan)("/switch <name>")} to move manually.`);
    }
}
async function cmdHandoff(env) {
    const acct = (0, accounts_1.activeAccount)(env.state);
    if (!acct) {
        (0, ui_1.err)("No active account — nothing to snapshot.");
        return;
    }
    env.writeHandoff("manual /handoff");
}
async function cmdHelp() {
    process.stdout.write(ui_1.HELP_TEXT + "\n");
}
async function runCommand(name, args, env) {
    switch (name) {
        case "add":
            return cmdAdd(env);
        case "accounts":
        case "list":
            return cmdAccounts(env);
        case "usage":
            return cmdUsage(env);
        case "switch":
            return cmdSwitch(env, args);
        case "autoswitch-on":
            return cmdAutoswitch(env, true);
        case "autoswitch-off":
            return cmdAutoswitch(env, false);
        case "handoff":
            return cmdHandoff(env);
        case "help":
            return cmdHelp();
        default:
            (0, ui_1.warn)(`Unknown command "/${name}". Press ${(0, ui_1.cyan)("/")} to see all commands.`);
    }
}
/** Registry driving the palette (order = display order). */
function commandRegistry(env) {
    const names = (partial) => env.accountNames(partial.toLowerCase());
    return [
        { name: "switch", usage: "/switch <name>", description: "switch account now", completeArg: names },
        { name: "accounts", usage: "/accounts", description: "list all accounts" },
        { name: "usage", usage: "/usage", description: "remaining quota, all accounts" },
        { name: "add", usage: "/add", description: "add a google account" },
        { name: "autoswitch-on", usage: "/autoswitch-on", description: "auto-switch on limits" },
        { name: "autoswitch-off", usage: "/autoswitch-off", description: "never switch automatically" },
        { name: "handoff", usage: "/handoff", description: "write handoff.md snapshot" },
        { name: "help", usage: "/help", description: "all commands" },
    ];
}
