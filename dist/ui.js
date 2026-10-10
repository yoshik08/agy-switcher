"use strict";
/* Tiny terminal UI helpers (no external deps — plain ANSI). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HELP_TEXT = exports.gray = exports.cyan = exports.blue = exports.yellow = exports.green = exports.red = exports.dim = exports.bold = void 0;
exports.tag = tag;
exports.info = info;
exports.ok = ok;
exports.warn = warn;
exports.err = err;
exports.table = table;
exports.banner = banner;
const codes = {
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
function wrap(code, s) {
    if (!process.stdout.isTTY)
        return s;
    return `${codes[code]}${s}${codes.reset}`;
}
const bold = (s) => wrap("bold", s);
exports.bold = bold;
const dim = (s) => wrap("dim", s);
exports.dim = dim;
const red = (s) => wrap("red", s);
exports.red = red;
const green = (s) => wrap("green", s);
exports.green = green;
const yellow = (s) => wrap("yellow", s);
exports.yellow = yellow;
const blue = (s) => wrap("blue", s);
exports.blue = blue;
const cyan = (s) => wrap("cyan", s);
exports.cyan = cyan;
const gray = (s) => wrap("gray", s);
exports.gray = gray;
/** Prefix for all geminiswitcher wrapper messages so they're distinguishable from agy output. */
function tag() {
    return (0, exports.cyan)("[geminiswitcher]");
}
function info(msg) {
    process.stdout.write(`${tag()} ${msg}\n`);
}
function ok(msg) {
    process.stdout.write(`${tag()} ${(0, exports.green)("✓")} ${msg}\n`);
}
function warn(msg) {
    process.stdout.write(`${tag()} ${(0, exports.yellow)("!")} ${msg}\n`);
}
function err(msg) {
    process.stdout.write(`${tag()} ${(0, exports.red)("✗")} ${msg}\n`);
}
/** Simple left-aligned table printer. */
function table(headers, rows) {
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
    const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
    process.stdout.write((0, exports.bold)(line(headers)) + "\n");
    process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n");
    for (const r of rows)
        process.stdout.write(line(r) + "\n");
}
function banner(version) {
    const out = process.stdout;
    out.write("\n");
    out.write((0, exports.bold)((0, exports.cyan)("  ◆ geminiswitcher")) + (0, exports.dim)(`  v${version}`) + "\n");
    out.write((0, exports.dim)("  multi-account wrapper for the Antigravity CLI (agy)") + "\n");
    out.write("\n");
}
exports.HELP_TEXT = `
${(0, exports.bold)("Slash commands")}  ${(0, exports.dim)("(intercepted by geminiswitcher — agy never sees them)")}

  ${(0, exports.cyan)("/add")}              Add a Google account via browser login (stored securely in OS keyring)
  ${(0, exports.cyan)("/accounts")}         List all accounts with plan, usage and active marker  ${(0, exports.dim)("(alias: /list)")}
  ${(0, exports.cyan)("/usage")}            Show remaining quota for all accounts, then ask agy for live current-account usage
  ${(0, exports.cyan)("/switch")} <name>    Manually switch to another account (restarts agy, resumes with -c)
  ${(0, exports.cyan)("/autoswitch-on")}    Enable automatic switching when a limit is hit
  ${(0, exports.cyan)("/autoswitch-off")}   Disable automatic switching entirely
  ${(0, exports.cyan)("/handoff")}          Write handoff.md snapshot on demand (optional, off by default)
  ${(0, exports.cyan)("/help")}             Show this help

${(0, exports.bold)("Autoswitch behavior")}

  ${(0, exports.green)("ON")}  — when a hard limit (RESOURCE_EXHAUSTED / 429) is detected in agy's output,
         geminiswitcher quits agy, swaps the next account's token into the
         system keyring (service=gemini, account=antigravity), and relaunches
         ${(0, exports.bold)("agy -c")} in the same directory so the conversation resumes.
         No handoff.md is written unless you enable it (config: handoffEnabled).

  ${(0, exports.yellow)("OFF")} — nothing automatic happens. No account switch, no resume,
         and ${(0, exports.bold)("no handoff.md is ever generated")}. You stay on the current
         account until you /switch manually or re-enable autoswitch.

${(0, exports.bold)("Context preservation")}
  True mid-process credential swapping doesn't work — a running agy holds its
  token in memory. So on switch we quit agy and relaunch with ${(0, exports.bold)("agy -c")}
  (or --conversation <id> when one was captured). Resume-based, minimal fuss.

${(0, exports.bold)("Limitations")}
  • The OS keyring slot agy reads is machine-wide (service=gemini, account=antigravity).
  • A running agy must be quit before its credentials can be swapped.
  • Quota figures are best-effort: cached from agy's own output; use /usage.
  • The /add login flow shells out to agy's own login command (configurable).
  • Tokens never leave your machine. No telemetry, ever.
`.trim();
