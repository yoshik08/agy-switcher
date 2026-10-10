/* Orchestration: account switching, limit handling, /add flow, handoff.md.
 *
 * Core principle: a running agy holds its keyring token in memory, so every
 * credential swap follows the same sequence:
 *   1. quit the agy process
 *   2. write the next account's token into the keyring (service=gemini, account=antigravity)
 *   3. relaunch agy with resume args (agy -c, or --conversation <id>)
 */
import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { Account, LimitSignal, State } from "./types";
import { activate, activeAccount, pickNextAccount, registerAccount } from "./accounts";
import { saveState } from "./store";
import { findVaultOwner, getActiveToken, setActiveToken } from "./keyring";
import { Session } from "./session";
import { bold, cyan, dim, err, info, ok, red, warn, yellow } from "./ui";

function relaunchArgs(state: State, conversationId: string | null): string[] {
  const s = state.settings;
  if (s.preferConversationId && conversationId) {
    return ["--conversation", conversationId];
  }
  return s.resumeArgs.length > 0 ? s.resumeArgs : ["-c"];
}

function fmtAccount(a: Account): string {
  const email = a.email ? dim(` <${a.email}>`) : "";
  const plan = a.plan ? dim(` · ${a.plan}`) : "";
  return `${bold(a.name)}${email}${plan}`;
}

/** Switch to `next` (token swap + relaunch). Caller must have stopped agy already. */
export async function switchToAccount(
  session: Session,
  state: State,
  next: Account,
  reason: string
): Promise<void> {
  const prev = activeAccount(state);
  info(
    `Switching accounts (${reason}): ${prev ? prev.name : "none"} → ${fmtAccount(next)}`
  );
  await activate(state, next);
  ok(`Token swapped into system keyring for "${next.name}".`);
  const args = relaunchArgs(state, session.conversationId);
  info(`Relaunching ${cyan(`agy ${args.join(" ")}`)} in ${dim(session.cwd)} …`);
  session.busy = true;
  try {
    await session.restart(args);
  } finally {
    session.busy = false;
  }
  ok(`Resumed on "${next.name}".`);
  const s = state.settings;
  if (s.injectContinuePrompt && s.continuePromptText.trim()) {
    setTimeout(() => {
      session.sendToAgy(s.continuePromptText.trim() + "\r");
    }, 1500);
  }
}

/** Handle a detected limit signal. The big autoswitch decision point. */
export async function handleLimit(
  session: Session,
  state: State,
  signal: LimitSignal
): Promise<void> {
  const acct = activeAccount(state);
  const who = acct ? `"${acct.name}"` : "current account";

  if (!state.settings.autoswitch) {
    // Explicitly: nothing automatic. No switch, no handoff.md — ever.
    warn(
      `Limit signal on ${who} (${signal.signal}) — autoswitch is ${yellow("OFF")}. ` +
        `Staying put. Use ${cyan("/switch <name>")} to change accounts manually.`
    );
    return;
  }

  if (signal.kind === "soft") {
    info(
      `Heads up: ${who} is approaching its limit (${signal.signal}). Will autoswitch on hard limit.`
    );
    return;
  }

  const next = pickNextAccount(state);
  if (!next) {
    err(
      `Hard limit on ${who} (${signal.signal}) but no other accounts are configured. ` +
        `Add one with ${cyan("/add")} — staying on ${who}.`
    );
    return;
  }

  process.stdout.write("\n");
  warn(`Limit detected on ${who} (${red(signal.signal)}). Autoswitch is ON.`);
  if (state.settings.handoffEnabled) {
    writeHandoff(state, session, acct, next, signal.signal);
  }
  await switchToAccount(session, state, next, `limit on ${who}`);
}

/** Minimal optional handoff snapshot. Only ever written when explicitly enabled. */
export function writeHandoff(
  state: State,
  session: Session,
  from: Account | null,
  to: Account,
  signal: string
): string {
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
  ok(`Wrote minimal ${cyan("handoff.md")} (enabled via config).`);
  return file;
}

/** Ask a y/n question while the terminal is in cooked mode. */
function askYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} ${dim("[y/N]")} `, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

function askLine(question: string): Promise<string> {
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
export async function addAccountFlow(session: Session | null, state: State): Promise<void> {
  const prevToken = await getActiveToken().catch(() => null);
  let suspended = false;

  try {
    if (session) {
      info("Adding an account briefly stops agy (it will resume afterwards).");
      const go = await withCooked(() => askYesNo("Continue with /add?"));
      if (!go) {
        info("Cancelled — agy left running.");
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
      info(
        `Running ${cyan(`agy ${cmd.join(" ")}`)} — complete the Google login in your browser…`
      );
      try {
        const res = child_process.spawnSync(agyPath, cmd, { stdio: "inherit" });
        if (res.error) {
          loginErr = (res.error as Error).message;
          continue;
        }
        loginOk = true;
        break;
      } catch (e) {
        loginErr = e instanceof Error ? e.message : String(e);
      }
    }

    if (!loginOk) {
      err(
        `Could not run agy's login flow (${loginErr || "unknown error"}). ` +
          `Set a custom command via the ${cyan("loginCommands")} setting (see README).`
      );
      return;
    }

    const captured = await getActiveToken().catch(() => null);
    if (!captured) {
      err("Login finished but no credential was captured from the keyring. Nothing was stored.");
      if (prevToken) await setActiveToken(prevToken).catch(() => undefined);
      return;
    }

    const existingId = await findVaultOwner(
      captured,
      state.accounts.map((a) => a.id)
    ).catch(() => null);
    if (existingId) {
      const dup = state.accounts.find((a) => a.id === existingId);
      warn(`That Google account is already added as "${dup?.name ?? existingId}".`);
      if (prevToken) await setActiveToken(prevToken).catch(() => undefined);
      return;
    }

    const name = await askLine(`${cyan("Name this account")} (e.g. personal, work): `);
    const account = await registerAccount(state, name || "account", captured);
    ok(
      `Stored "${account.name}"${account.email ? ` <${account.email}>` : ""} securely in the OS keyring.`
    );

    if (state.accounts.length === 1) {
      // First account becomes active and stays in the slot.
      state.activeAccountId = account.id;
      account.lastUsed = new Date().toISOString();
      saveState(state);
      ok(`"${account.name}" is now the active account.`);
    } else if (prevToken) {
      // Restore whoever was active before, so /add doesn't yank the session sideways.
      await setActiveToken(prevToken).catch(() => undefined);
      info(
        `Kept your current account active — use ${cyan(`/switch ${account.name}`)} to move over.`
      );
    }
  } finally {
    if (session && suspended) {
      session.attach();
      session.launch(relaunchArgs(state, session.conversationId));
      ok("agy relaunched.");
    }
  }
}

/** Run a function with the terminal in cooked mode (for readline prompts). */
async function withCooked<T>(fn: () => Promise<T>): Promise<T> {
  const wasRaw = !!(
    process.stdin.isTTY && (process.stdin as unknown as { isRaw?: boolean }).isRaw
  );
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    return await fn();
  } finally {
    if (wasRaw && process.stdin.isTTY) process.stdin.setRawMode(true);
  }
}
