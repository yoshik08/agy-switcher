/* Slash commands: a registry (drives the palette) + implementations.
 * Commands run in geminiswitcher — agy never sees them.
 */
import { Account, State } from "./types";
import { PaletteCommand } from "./palette";
import { activeAccount, findAccounts } from "./accounts";
import {
  HELP_TEXT,
  bold,
  cyan,
  dim,
  err,
  green,
  info,
  ok,
  relTime,
  table,
  warn,
  yellow,
} from "./ui";

export interface CmdEnv {
  state: State;
  switchTo(account: Account, reason: string): Promise<void>;
  addAccount(): Promise<void>;
  setAutoswitch(on: boolean): void;
  writeHandoff(reason: string): void;
  forwardToAgy(text: string): void;
  accountNames(partial: string): string[];
}

function accountsTable(state: State): void {
  const activeId = state.activeAccountId;
  const rows = state.accounts.map((a) => [
    (a.id === activeId ? green("● ") : "  ") + a.name,
    a.email ?? dim("unknown"),
    a.plan ?? dim("unknown"),
    a.lastQuota ? `${a.lastQuota.text} ${dim(`(${relTime(a.lastQuota.at)})`)}` : dim("not seen yet"),
    relTime(a.lastUsed),
  ]);
  if (rows.length === 0) {
    warn(`No accounts yet. Run ${cyan("/add")} to connect your first Google account.`);
    return;
  }
  table(["account", "email", "plan", "quota", "last used"], rows);
}

async function cmdAdd(env: CmdEnv): Promise<void> {
  await env.addAccount();
}

async function cmdAccounts(env: CmdEnv): Promise<void> {
  accountsTable(env.state);
}

async function cmdUsage(env: CmdEnv): Promise<void> {
  info(bold("Remaining usage (observed from agy's own output):"));
  accountsTable(env.state);
  if (env.state.settings.forwardUsageToAgy) {
    info(dim("Asking agy for the live current-account figure…"));
    env.forwardToAgy("/usage\r");
  }
}

async function cmdSwitch(env: CmdEnv, args: string[]): Promise<void> {
  const { state } = env;
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
    err(
      `"${query}" matches: ${matches.map((m) => m.name).join(", ")}. Be more specific (tab completes).`
    );
    return;
  }
  const target = matches[0];
  if (target.id === state.activeAccountId) {
    info(`"${target.name}" is already active.`);
    return;
  }
  await env.switchTo(target, "manual /switch");
}

async function cmdAutoswitch(env: CmdEnv, on: boolean): Promise<void> {
  env.setAutoswitch(on);
  if (on) {
    ok(`Autoswitch ${green("on")} — hard limits will trigger a switch + resume.`);
  } else {
    ok(
      `Autoswitch ${yellow("off")} — nothing automatic from here on. No switches, ` +
        `and ${bold("no handoff.md will ever be written")}. ${cyan("/switch <name>")} to move manually.`
    );
  }
}

async function cmdHandoff(env: CmdEnv): Promise<void> {
  const acct = activeAccount(env.state);
  if (!acct) {
    err("No active account — nothing to snapshot.");
    return;
  }
  env.writeHandoff("manual /handoff");
}

async function cmdHelp(): Promise<void> {
  process.stdout.write(HELP_TEXT + "\n");
}

export async function runCommand(
  name: string,
  args: string[],
  env: CmdEnv
): Promise<void> {
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
      warn(`Unknown command "/${name}". Press ${cyan("/")} to see all commands.`);
  }
}

/** Registry driving the palette (order = display order). */
export function commandRegistry(env: CmdEnv): PaletteCommand[] {
  const names = (partial: string) =>
    env.accountNames(partial.toLowerCase());
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
