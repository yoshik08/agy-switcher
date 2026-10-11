#!/usr/bin/env node
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
import { VERSION } from "./config";
import { loadState, saveState } from "./store";
import { activeAccount, ensureActiveSlot, registerAccount } from "./accounts";
import { findVaultOwner, getActiveToken, setActiveToken } from "./keyring";
import { Application } from "./app";
import { banner, bold, cyan, dim, err, HELP_TEXT, info, ok } from "./ui";
import * as readline from "readline";

interface CliOpts {
  help: boolean;
  version: boolean;
  addOnly: boolean;
  agyPath: string | null;
  agyArgs: string[];
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { help: false, version: false, addOnly: false, agyPath: null, agyArgs: [] };
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
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--version" || a === "-v") opts.version = true;
    else if (a === "--add") opts.addOnly = true;
    else if (a === "--agy-path") {
      i++;
      if (i >= argv.length) throw new Error("--agy-path needs a value");
      opts.agyPath = argv[i];
    } else {
      opts.agyArgs.push(a);
    }
    i++;
  }
  return opts;
}

function printUsage(): void {
  process.stdout.write(
    [
      bold(`geminiswitcher v${VERSION}`),
      dim("claude-code-style home for the antigravity cli"),
      "",
      `Usage: ${cyan("geminiswitcher")} [options] [-- agy-args...]`,
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
    ].join("\n")
  );
}

/** Headless /add for --add and first-run (no application session). */
async function headlessAdd(): Promise<boolean> {
  const { loadState: ls, saveState: ss } = await import("./store");
  const state = ls();
  const prevToken = await getActiveToken().catch(() => null);
  const cmd = state.settings.loginCommand;

  info(`Running ${cyan(`agy ${cmd.join(" ")}`)} — complete the Google login in your browser…`);
  const { spawnSync } = await import("child_process");
  const res = spawnSync(state.settings.agyPath, cmd, { stdio: "inherit" });
  if (res.error) {
    err(`Could not run agy ${cmd.join(" ")}: ${(res.error as Error).message}`);
    return false;
  }
  const captured = await getActiveToken().catch(() => null);
  if (!captured) {
    err("Login finished but no credential landed in the keyring. Nothing was stored.");
    if (prevToken) await setActiveToken(prevToken).catch(() => undefined);
    return false;
  }
  const dup = await findVaultOwner(captured, state.accounts.map((a) => a.id)).catch(() => null);
  if (dup) {
    const existing = state.accounts.find((a) => a.id === dup);
    err(`That Google account is already added as "${existing?.name ?? dup}".`);
    if (prevToken) await setActiveToken(prevToken).catch(() => undefined);
    return false;
  }
  const name = await new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${cyan("Name this account")} (e.g. personal, work): `, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
  const account = await registerAccount(state, name || "account", captured);
  ok(`Stored "${account.name}"${account.email ? ` <${account.email}>` : ""} in the OS keyring.`);
  if (!state.activeAccountId) {
    state.activeAccountId = account.id;
    account.lastUsed = new Date().toISOString();
    ss(state);
    ok(`"${account.name}" is now the active account.`);
  } else if (prevToken) {
    await setActiveToken(prevToken).catch(() => undefined);
  }
  return true;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printUsage();
    process.stdout.write(HELP_TEXT + "\n");
    return;
  }
  if (opts.version) {
    process.stdout.write(`geminiswitcher ${VERSION}\n`);
    return;
  }

  const state = loadState();
  if (opts.agyPath) state.settings.agyPath = opts.agyPath;
  saveState(state);

  if (opts.addOnly) {
    const okAdded = await headlessAdd();
    process.exitCode = okAdded ? 0 : 1;
    return;
  }

  if (state.accounts.length === 0) {
    banner(VERSION);
    info("No accounts yet — let's connect your first Google account.");
    info(dim(`This runs ${cyan("agy auth login")} and stores the result securely.`));
    const okAdded = await headlessAdd();
    if (!okAdded || loadState().accounts.length === 0) {
      err("No accounts configured. Run with --add to try again.");
      process.exitCode = 1;
      return;
    }
  }

  const fresh = loadState();
  if (opts.agyPath) fresh.settings.agyPath = opts.agyPath;
  const acct = activeAccount(fresh);
  if (!acct) {
    err("No active account is set. This is a bug — please report it.");
    process.exitCode = 1;
    return;
  }

  const app = new Application(fresh, opts.agyArgs, process.cwd());
  await app.run();
}

main().catch((e) => {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write("\x1b[r");
  } catch {
    /* ignore */
  }
  process.stderr.write(`geminiswitcher: fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
