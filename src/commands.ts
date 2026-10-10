/* Slash command implementations. These run in the wrapper — agy never sees them. */
import { State } from "./types";
import { Session } from "./session";
import { activeAccount, findAccounts } from "./accounts";
import { saveState } from "./store";
import { addAccountFlow, switchToAccount, writeHandoff } from "./orchestrate";
import { bold, cyan, dim, err, green, HELP_TEXT, info, ok, table, warn, yellow } from "./ui";

export interface CommandContext {
  session: Session;
  state: State;
  /** End the whole geminiswitcher session (quits agy too). */
  quit: () => Promise<void>;
}

function rel(v: string | null | undefined): string {
  if (!v) return dim("—");
  const ms = Date.now() - new Date(v).getTime();
  if (ms < 0) return dim("—");
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function accountsTable(state: State): void {
  const activeId = state.activeAccountId;
  const rows = state.accounts.map((a) => [
    (a.id === activeId ? green("● ") : "  ") + a.name,
    a.email ?? dim("unknown"),
    a.plan ?? dim("unknown"),
    a.lastQuota ? `${a.lastQuota.text} ${dim(`(${rel(a.lastQuota.at)})`)}` : dim("not observed yet"),
    rel(a.lastUsed),
  ]);
  if (rows.length === 0) {
    warn(`No accounts yet. Run ${cyan("/add")} to connect your first Google account.`);
    return;
  }
  table(["account", "email", "plan", "quota", "last used"], rows);
}

export async function handleSlashCommand(
  cmd: string,
  args: string[],
  ctx: CommandContext
): Promise<void> {
  const { session, state } = ctx;

  switch (cmd) {
    case "add": {
      if (session.busy) {
        warn("An account switch is already in progress — wait for it to finish, then /add.");
        return;
      }
      await addAccountFlow(session, state);
      return;
    }

    case "accounts":
    case "list": {
      accountsTable(state);
      return;
    }

    case "usage": {
      info(bold("Remaining usage (best-effort cache from agy output):"));
      accountsTable(state);
      if (state.settings.forwardUsageToAgy) {
        info(dim("Asking agy for live current-account usage…"));
        // Forward as if the user typed it, bypassing our shadow buffer.
        session.sendToAgy("/usage\r");
      } else {
        info(dim("Live forwarding disabled (forwardUsageToAgy=false)."));
      }
      return;
    }

    case "switch": {
      if (session.busy) {
        warn("An account switch is already in progress — hold on.");
        return;
      }
      const query = args.join(" ").trim();
      if (!query) {
        err(`Usage: ${cyan("/switch <name>")} — pick from:`);
        accountsTable(state);
        return;
      }
      const matches = findAccounts(state, query);
      if (matches.length === 0) {
        err(`No account matches "${query}".`);
        accountsTable(state);
        return;
      }
      if (matches.length > 1) {
        err(`"${query}" matches multiple accounts: ${matches.map((m) => m.name).join(", ")}. Be more specific.`);
        return;
      }
      const target = matches[0];
      if (target.id === state.activeAccountId) {
        info(`"${target.name}" is already active.`);
        return;
      }
      await switchToAccount(session, state, target, "manual /switch");
      return;
    }

    case "autoswitch-on": {
      state.settings.autoswitch = true;
      saveState(state);
      ok(`Autoswitch ${green("ON")} — limits will trigger an automatic account switch + resume.`);
      return;
    }

    case "autoswitch-off": {
      state.settings.autoswitch = false;
      saveState(state);
      ok(
        `Autoswitch ${yellow("OFF")} — nothing automatic will happen from here on. ` +
          `No account switches, and ${bold("no handoff.md will ever be generated")}. ` +
          `Use ${cyan("/switch <name>")} to change accounts yourself.`
      );
      return;
    }

    case "handoff": {
      const acct = activeAccount(state);
      if (!acct) {
        err("No active account — nothing to snapshot.");
        return;
      }
      writeHandoff(state, session, acct, acct, "manual /handoff");
      return;
    }

    case "help": {
      process.stdout.write(HELP_TEXT + "\n");
      return;
    }

    default: {
      warn(`Unknown command "/${cmd}". Type ${cyan("/help")}.`);
      return;
    }
  }
}
