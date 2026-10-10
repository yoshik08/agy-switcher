"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSlashCommand = handleSlashCommand;
const accounts_1 = require("./accounts");
const store_1 = require("./store");
const orchestrate_1 = require("./orchestrate");
const ui_1 = require("./ui");
function rel(v) {
    if (!v)
        return (0, ui_1.dim)("—");
    const ms = Date.now() - new Date(v).getTime();
    if (ms < 0)
        return (0, ui_1.dim)("—");
    const m = Math.floor(ms / 60000);
    if (m < 1)
        return "just now";
    if (m < 60)
        return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)
        return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}
function accountsTable(state) {
    const activeId = state.activeAccountId;
    const rows = state.accounts.map((a) => [
        (a.id === activeId ? (0, ui_1.green)("● ") : "  ") + a.name,
        a.email ?? (0, ui_1.dim)("unknown"),
        a.plan ?? (0, ui_1.dim)("unknown"),
        a.lastQuota ? `${a.lastQuota.text} ${(0, ui_1.dim)(`(${rel(a.lastQuota.at)})`)}` : (0, ui_1.dim)("not observed yet"),
        rel(a.lastUsed),
    ]);
    if (rows.length === 0) {
        (0, ui_1.warn)(`No accounts yet. Run ${(0, ui_1.cyan)("/add")} to connect your first Google account.`);
        return;
    }
    (0, ui_1.table)(["account", "email", "plan", "quota", "last used"], rows);
}
async function handleSlashCommand(cmd, args, ctx) {
    const { session, state } = ctx;
    switch (cmd) {
        case "add": {
            if (session.busy) {
                (0, ui_1.warn)("An account switch is already in progress — wait for it to finish, then /add.");
                return;
            }
            await (0, orchestrate_1.addAccountFlow)(session, state);
            return;
        }
        case "accounts":
        case "list": {
            accountsTable(state);
            return;
        }
        case "usage": {
            (0, ui_1.info)((0, ui_1.bold)("Remaining usage (best-effort cache from agy output):"));
            accountsTable(state);
            if (state.settings.forwardUsageToAgy) {
                (0, ui_1.info)((0, ui_1.dim)("Asking agy for live current-account usage…"));
                // Forward as if the user typed it, bypassing our shadow buffer.
                session.sendToAgy("/usage\r");
            }
            else {
                (0, ui_1.info)((0, ui_1.dim)("Live forwarding disabled (forwardUsageToAgy=false)."));
            }
            return;
        }
        case "switch": {
            if (session.busy) {
                (0, ui_1.warn)("An account switch is already in progress — hold on.");
                return;
            }
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
                (0, ui_1.err)(`"${query}" matches multiple accounts: ${matches.map((m) => m.name).join(", ")}. Be more specific.`);
                return;
            }
            const target = matches[0];
            if (target.id === state.activeAccountId) {
                (0, ui_1.info)(`"${target.name}" is already active.`);
                return;
            }
            await (0, orchestrate_1.switchToAccount)(session, state, target, "manual /switch");
            return;
        }
        case "autoswitch-on": {
            state.settings.autoswitch = true;
            (0, store_1.saveState)(state);
            (0, ui_1.ok)(`Autoswitch ${(0, ui_1.green)("ON")} — limits will trigger an automatic account switch + resume.`);
            return;
        }
        case "autoswitch-off": {
            state.settings.autoswitch = false;
            (0, store_1.saveState)(state);
            (0, ui_1.ok)(`Autoswitch ${(0, ui_1.yellow)("OFF")} — nothing automatic will happen from here on. ` +
                `No account switches, and ${(0, ui_1.bold)("no handoff.md will ever be generated")}. ` +
                `Use ${(0, ui_1.cyan)("/switch <name>")} to change accounts yourself.`);
            return;
        }
        case "handoff": {
            const acct = (0, accounts_1.activeAccount)(state);
            if (!acct) {
                (0, ui_1.err)("No active account — nothing to snapshot.");
                return;
            }
            (0, orchestrate_1.writeHandoff)(state, session, acct, acct, "manual /handoff");
            return;
        }
        case "help": {
            process.stdout.write(ui_1.HELP_TEXT + "\n");
            return;
        }
        default: {
            (0, ui_1.warn)(`Unknown command "/${cmd}". Type ${(0, ui_1.cyan)("/help")}.`);
            return;
        }
    }
}
