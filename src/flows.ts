/* Guided flows: account switching and adding.
 * Both take over the screen with a clean panel, run an explicit sequence,
 * and hand the terminal back. Nothing happens invisibly.
 */
import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { Account, State } from "./types";
import { Terminal } from "./terminal";
import { PtyHost } from "./pty_host";
import { InputRouter } from "./input";
import { activate, activeAccount, pickNextAccount, registerAccount } from "./accounts";
import { saveState } from "./store";
import { findVaultOwner, getActiveToken, setActiveToken } from "./keyring";
import {
  accountLabel,
  cyan,
  dim,
  err,
  green,
  info,
  ok,
  panel,
  warn,
  yellow,
} from "./ui";

export interface FlowContext {
  term: Terminal;
  pty: PtyHost;
  state: State;
  cwd: string;
  router: InputRouter;
  refreshStatus(extra?: string): void;
  recentOutput(): string;
  conversationId(): string | null;
}

function resumeArgs(state: State, conversationId: string | null): string[] {
  const s = state.settings;
  if (s.preferConversationId && conversationId) return ["--conversation", conversationId];
  return s.resumeArgs.length > 0 ? s.resumeArgs : ["-c"];
}

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

/** Run fn with the terminal in cooked mode (for readline prompts). */
async function cooked<T>(term: Terminal, fn: () => Promise<T>): Promise<T> {
  const wasRaw = term.isRaw;
  term.exitRaw();
  try {
    return await fn();
  } finally {
    if (wasRaw) term.enterRaw();
  }
}

function step(text: string): void {
  process.stdout.write(`  ${dim("→")} ${text}\n`);
}

function stepOk(text: string): void {
  process.stdout.write(`  ${green("✓")} ${text}\n`);
}

/* ---------------------------------------------------------- switch flow */

export async function switchFlow(
  ctx: FlowContext,
  target: Account | null,
  reason: string,
  signal?: string
): Promise<boolean> {
  const { state, term, pty, router } = ctx;
  router.setMode("blocking");

  const prev = activeAccount(state);
  const next = target ?? pickNextAccount(state);

  const title = signal
    ? `${yellow("▲")} limit detected ${dim(`(${signal})`)}`
    : `${cyan("◆")} switching account`;
  term.write(panel(title, []));

  if (!next) {
    err(
      `No other account to switch to. Add one with ${cyan("/add")} — staying on ` +
        (prev ? `"${prev.name}"` : "the current account") + "."
    );
    router.setMode("agy");
    ctx.refreshStatus();
    return false;
  }

  try {
    step(`from ${prev ? accountLabel(prev) : dim("none")} ${dim("→")} to ${accountLabel(next)} ${dim(`(${reason})`)}`);
    if (state.settings.handoffEnabled) {
      writeHandoffFile(ctx, prev, next, signal ?? reason);
    }
    step("quitting agy…");
    await pty.terminate();
    step("installing token in system keyring…");
    await activate(state, next, ctx.cwd);
    stepOk(`keyring now serves "${next.name}"`);
    const args = resumeArgs(state, ctx.conversationId());
    step(`relaunching ${cyan(`agy ${args.join(" ")}`)}…`);
    pty.spawn(args, term.cols, term.ptyRows);
    stepOk(`resumed on "${next.name}"`);
    if (state.settings.injectContinuePrompt && state.settings.continuePromptText.trim()) {
      setTimeout(() => pty.write(state.settings.continuePromptText.trim() + "\r"), 1500);
    }
    term.write("\n");
    ok(`Now on ${accountLabel(next)}.`);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    // Try to get agy back up even if the switch failed.
    if (!pty.alive) {
      try {
        pty.spawn(resumeArgs(state, ctx.conversationId()), term.cols, term.ptyRows);
        warn("Relaunched agy on the previous account.");
      } catch {
        err("Could not relaunch agy. Restart geminiswitcher.");
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

export async function addFlow(ctx: FlowContext, sessionRunning: boolean): Promise<void> {
  const { state, term, pty, router } = ctx;
  router.setMode("blocking");
  term.write(panel(`${cyan("◆")} add a google account`, []));

  const prevToken = await getActiveToken().catch(() => null);

  try {
    if (sessionRunning) {
      const go = await cooked(term, () =>
        ask(`This briefly restarts agy (it will resume). Continue? ${dim("[y/N]")} `)
      );
      if (!/^y(es)?$/i.test(go.trim())) {
        info("Cancelled — agy left running.");
        return;
      }
      step("stopping agy…");
      await pty.terminate();
    }

    const cmd = state.settings.loginCommand;
    step(`Running ${cyan(`agy ${cmd.join(" ")}`)} — complete the Google login in your browser…`);
    term.write(dim("  (the login runs in your real terminal, not inside geminiswitcher)\n"));

    // Leave raw mode off for the login's own terminal UI.
    term.exitRaw();
    let loginOk = false;
    let loginErr = "";
    try {
      const res = child_process.spawnSync(state.settings.agyPath, cmd, { stdio: "inherit" });
      if (res.error) loginErr = (res.error as Error).message;
      else loginOk = true;
    } catch (e) {
      loginErr = e instanceof Error ? e.message : String(e);
    }
    term.enterRaw();

    if (!loginOk) {
      err(
        `Could not run ${cyan(`agy ${cmd.join(" ")}`)} (${loginErr || "unknown error"}). ` +
          `Check that agy is installed, or set a custom ${cyan("loginCommand")} in the config.`
      );
      return;
    }

    const captured = await getActiveToken().catch(() => null);
    if (!captured) {
      err("Login finished but no credential landed in the keyring. Nothing was stored.");
      if (prevToken) await setActiveToken(prevToken).catch(() => undefined);
      return;
    }

    const dup = await findVaultOwner(captured, state.accounts.map((a) => a.id)).catch(() => null);
    if (dup) {
      const existing = state.accounts.find((a) => a.id === dup);
      warn(`That Google account is already added as "${existing?.name ?? dup}".`);
      if (prevToken) await setActiveToken(prevToken).catch(() => undefined);
      return;
    }

    const name = await cooked(term, () =>
      ask(`${cyan("Name this account")} (e.g. personal, work): `)
    );
    const account = await registerAccount(state, name || "account", captured);
    stepOk(
      `Stored "${account.name}"${account.email ? ` <${account.email}>` : ""} in the OS keyring.`
    );

    if (state.accounts.length === 1) {
      state.activeAccountId = account.id;
      account.lastUsed = new Date().toISOString();
      saveState(state);
      ok(`"${account.name}" is now the active account.`);
    } else if (prevToken) {
      await setActiveToken(prevToken).catch(() => undefined);
      info(`Kept your current account — ${cyan(`/switch ${account.name}`)} to move over.`);
    } else {
      // No previous session: activate the new account.
      await activate(state, account, ctx.cwd);
      ok(`"${account.name}" is now the active account.`);
    }
  } finally {
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

export function writeHandoffFile(
  ctx: FlowContext,
  from: Account | null,
  to: Account,
  reason: string
): string {
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
  ok(`Wrote ${cyan("handoff.md")} ${dim("(opt-in snapshot)")} → ${file}`);
  return file;
}
