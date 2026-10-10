#!/usr/bin/env node
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
import { VERSION } from "./config";
import { loadState, saveState } from "./store";
import { activeAccount, ensureActiveSlot } from "./accounts";
import { Session } from "./session";
import { handleSlashCommand } from "./commands";
import { addAccountFlow, handleLimit } from "./orchestrate";
import { banner, bold, cyan, dim, err, HELP_TEXT, info, ok } from "./ui";

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
      // Unknown flags and positionals belong to agy.
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
      dim("multi-account wrapper for the Antigravity CLI (agy)"),
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
      `Example: ${cyan("geminiswitcher -- --model foo")}  (passes --model foo to agy)`,
      "",
      "Inside a session, slash commands are intercepted:",
      "  /add  /accounts  /usage  /switch <name>  /autoswitch-on  /autoswitch-off  /help",
      "",
    ].join("\n")
  );
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

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    err("geminiswitcher needs an interactive terminal.");
    process.exitCode = 1;
    return;
  }

  const state = loadState();
  if (opts.agyPath) state.settings.agyPath = opts.agyPath;
  saveState(state);

  if (opts.addOnly) {
    await addAccountFlow(null, state);
    return;
  }

  // First run: no accounts yet → walk through /add, then continue into a session.
  if (state.accounts.length === 0) {
    banner(VERSION);
    info("No accounts yet. Let's add your first Google account.");
    await addAccountFlow(null, state);
    if (state.accounts.length === 0) {
      err("No accounts configured — quitting. Run with --add to try again.");
      process.exitCode = 1;
      return;
    }
  }

  const acct = activeAccount(state);
  if (!acct) {
    err("No active account is set. This is a bug — please report it.");
    process.exitCode = 1;
    return;
  }

  // Make sure the keyring slot agy reads holds the active account's token.
  try {
    await ensureActiveSlot(state);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }

  banner(VERSION);
  const planBit = acct.plan ? ` · ${acct.plan}` : "";
  const emailBit = acct.email ? ` <${acct.email}>` : "";
  info(
    `Account: ${bold(acct.name)}${dim(emailBit)}${dim(planBit)}   Autoswitch: ${
      state.settings.autoswitch ? bold("ON") : dim("OFF")
    }`
  );
  info(`Type ${cyan("/help")} inside the session for commands. Launching agy…`);
  process.stdout.write("\n");

  const cwd = process.cwd();

  let resolveDone!: () => void;
  const sessionDone = new Promise<void>((r) => {
    resolveDone = r;
  });

  const session = new Session(state, state.settings.agyPath, opts.agyArgs, cwd, {
    onSlash: async (cmd, args) => {
      await handleSlashCommand(cmd, args, {
        session,
        state,
        quit: async () => {
          await session.end();
          resolveDone();
        },
      });
    },
    onLimit: async (signal) => {
      await handleLimit(session, state, signal);
    },
    onEnd: async (code) => {
      process.stdout.write("\n");
      info(
        `agy exited (code ${code}). Session over — run ${cyan("geminiswitcher")} to start again.`
      );
      resolveDone();
    },
  });

  session.attach();
  try {
    session.launch([]);
  } catch (e) {
    await session.end();
    err(
      `Could not launch "${state.settings.agyPath}": ${
        e instanceof Error ? e.message : String(e)
      }. Is agy installed and on your PATH? Override with --agy-path.`
    );
    process.exitCode = 1;
    return;
  }

  // Resolves when agy exits on its own (restarts don't resolve it).
  await sessionDone;

  try {
    await session.end();
  } catch {
    /* ignore */
  }
  ok("Bye.");
}

main().catch((e) => {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    /* ignore */
  }
  process.stderr.write(`geminiswitcher: fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
