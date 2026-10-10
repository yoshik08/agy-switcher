/* Tiny terminal UI helpers (no external deps — plain ANSI). */

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
export const cyan = (s: string) => wrap("cyan", s);
export const gray = (s: string) => wrap("gray", s);

/** Prefix for all geminiswitcher wrapper messages so they're distinguishable from agy output. */
export function tag(): string {
  return cyan("[geminiswitcher]");
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

/** Simple left-aligned table printer. */
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
  out.write(dim("  multi-account wrapper for the Antigravity CLI (agy)") + "\n");
  out.write("\n");
}

export const HELP_TEXT = `
${bold("Slash commands")}  ${dim("(intercepted by geminiswitcher — agy never sees them)")}

  ${cyan("/add")}              Add a Google account via browser login (stored securely in OS keyring)
  ${cyan("/accounts")}         List all accounts with plan, usage and active marker  ${dim("(alias: /list)")}
  ${cyan("/usage")}            Show remaining quota for all accounts, then ask agy for live current-account usage
  ${cyan("/switch")} <name>    Manually switch to another account (restarts agy, resumes with -c)
  ${cyan("/autoswitch-on")}    Enable automatic switching when a limit is hit
  ${cyan("/autoswitch-off")}   Disable automatic switching entirely
  ${cyan("/handoff")}          Write handoff.md snapshot on demand (optional, off by default)
  ${cyan("/help")}             Show this help

${bold("Autoswitch behavior")}

  ${green("ON")}  — when a hard limit (RESOURCE_EXHAUSTED / 429) is detected in agy's output,
         geminiswitcher quits agy, swaps the next account's token into the
         system keyring (service=gemini, account=antigravity), and relaunches
         ${bold("agy -c")} in the same directory so the conversation resumes.
         No handoff.md is written unless you enable it (config: handoffEnabled).

  ${yellow("OFF")} — nothing automatic happens. No account switch, no resume,
         and ${bold("no handoff.md is ever generated")}. You stay on the current
         account until you /switch manually or re-enable autoswitch.

${bold("Context preservation")}
  True mid-process credential swapping doesn't work — a running agy holds its
  token in memory. So on switch we quit agy and relaunch with ${bold("agy -c")}
  (or --conversation <id> when one was captured). Resume-based, minimal fuss.

${bold("Limitations")}
  • The OS keyring slot agy reads is machine-wide (service=gemini, account=antigravity).
  • A running agy must be quit before its credentials can be swapped.
  • Quota figures are best-effort: cached from agy's own output; use /usage.
  • The /add login flow shells out to agy's own login command (configurable).
  • Tokens never leave your machine. No telemetry, ever.
`.trim();
