/* Terminal UI helpers (no external deps — plain ANSI) + status bar builder. */
import { Account, State } from "./types";

const codes: Record<string, string> = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function wrap(code: string, s: string): string {
  if (!process.stdout.isTTY) return s;
  return `${codes[code]}${s}${codes.reset}`;
}

export const bold = (s: string) => wrap("bold", s);
export const dim = (s: string) => wrap("dim", s);
export const red = (s: string) => wrap("red", s);
export const green = (s: string) => wrap("green", s);
export const yellow = (s: string) => wrap("yellow", s);
export const blue = (s: string) => wrap("blue", s);
export const magenta = (s: string) => wrap("magenta", s);
export const cyan = (s: string) => wrap("cyan", s);
export const gray = (s: string) => wrap("gray", s);

export function tag(): string {
  return cyan("◆ geminiswitcher");
}

export function info(msg: string): void {
  process.stdout.write(`${tag()} ${msg}\n`);
}

export function ok(msg: string): void {
  process.stdout.write(`${tag()} ${green("✓")} ${msg}\n`);
}

export function warn(msg: string): void {
  process.stdout.write(`${tag()} ${yellow("!")} ${msg}\n`);
}

export function err(msg: string): void {
  process.stdout.write(`${tag()} ${red("✗")} ${msg}\n`);
}

export function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  process.stdout.write(bold(line(headers)) + "\n");
  process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n");
  for (const r of rows) process.stdout.write(line(r) + "\n");
}

export function banner(version: string): void {
  const out = process.stdout;
  out.write("\n");
  out.write(bold(cyan("  ◆ geminiswitcher")) + dim(`  v${version}`) + "\n");
  out.write(dim("  claude-code-style home for the antigravity cli") + "\n");
  out.write("\n");
}

/** One-line status bar: fits the terminal width, truncated if needed. */
export function statusBar(state: State, cols: number, extra?: string): string {
  const acct = state.accounts.find((a) => a.id === state.activeAccountId) ?? null;
  const dot = state.settings.autoswitch ? green("●") : gray("○");
  const who = acct
    ? `${bold(acct.name)}${acct.plan ? dim(` ${acct.plan.replace(/^AI\s*/, "")}`) : ""}`
    : dim("no account");
  const quota =
    acct?.lastQuota && isFresh(acct.lastQuota.at) ? dim(` · ${acct.lastQuota.text}`) : "";
  const right = `${state.settings.autoswitch ? dim("autoswitch on") : dim("autoswitch off")} ${dim("·")} ${dim("/ or ctrl+g")}`;
  const mid = extra ? ` ${yellow("!")} ${extra}` : "";
  let left = `${dot} ${who}${quota}${mid}`;
  // crude width fit: strip to cols
  const plain = stripAnsi(left + "   " + right);
  if (plain.length > cols) {
    left = `${dot} ${acct ? bold(acct.name) : dim("no account")}${mid}`;
  }
  const gap = Math.max(1, cols - stripAnsi(left).length - stripAnsi(right).length);
  return `${left}${" ".repeat(gap)}${right}`;
}

function isFresh(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 6 * 60 * 60 * 1000;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function relTime(v: string | null | undefined): string {
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

/** A clean full-width panel block for flow progress (switch/add). */
export function panel(title: string, lines: string[]): string {
  const bar = dim("─".repeat(52));
  return [`\n${bar}`, `${bold(title)}`, ...lines.map((l) => `  ${l}`), `${bar}\n`].join("\n");
}

export function accountLabel(a: Account): string {
  const email = a.email ? dim(` <${a.email}>`) : "";
  const plan = a.plan ? dim(` · ${a.plan}`) : "";
  return `${bold(a.name)}${email}${plan}`;
}

export const HELP_TEXT = `
${bold("Commands")}  ${dim("(press / or ctrl+g anywhere — agy never sees these)")}

  ${cyan("/add")}              Add a Google account via ${bold("agy auth login")} (stored in OS keyring)
  ${cyan("/accounts")}         List all accounts with plan, usage and active marker  ${dim("(alias: /list)")}
  ${cyan("/usage")}            Remaining quota for all accounts, then live current-account usage from agy
  ${cyan("/switch")} <name>    Switch account now (tab-completes names, resumes with -c)
  ${cyan("/autoswitch-on")}    Enable automatic switching when a limit is hit
  ${cyan("/autoswitch-off")}   Disable automatic switching entirely
  ${cyan("/handoff")}          Write a handoff.md snapshot on demand (optional, off by default)
  ${cyan("/help")}             This help

${bold("Autoswitch")}

  ${green("ON")}  — on a hard limit (RESOURCE_EXHAUSTED / 429) geminiswitcher takes over
         the screen, swaps the next account's token into the keyring
         (service=gemini, account=antigravity), and relaunches ${bold("agy -c")}
         in the same directory. No handoff.md unless you enabled it.

  ${yellow("OFF")} — nothing automatic. No switches, and ${bold("no handoff.md is ever written")}.
         You stay put until you /switch manually.

${bold("Context")}  Resume-based: a running agy holds its token in memory, so every
         switch quits agy and relaunches with ${bold("agy -c")} (or --conversation <id>).
         The dying account is never asked to write a summary.

${bold("Notes")}    The keyring slot agy reads is machine-wide. Quota figures are
         best-effort observations from agy's own output. Tokens never leave
         this machine. No telemetry.
`.trim();
