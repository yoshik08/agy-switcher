"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HELP_TEXT = exports.gray = exports.cyan = exports.magenta = exports.blue = exports.yellow = exports.green = exports.red = exports.dim = exports.bold = void 0;
exports.tag = tag;
exports.info = info;
exports.ok = ok;
exports.warn = warn;
exports.err = err;
exports.table = table;
exports.banner = banner;
exports.statusBar = statusBar;
exports.relTime = relTime;
exports.panel = panel;
exports.accountLabel = accountLabel;
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
const magenta = (s) => wrap("magenta", s);
exports.magenta = magenta;
const cyan = (s) => wrap("cyan", s);
exports.cyan = cyan;
const gray = (s) => wrap("gray", s);
exports.gray = gray;
function tag() {
    return (0, exports.cyan)("◆ geminiswitcher");
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
    out.write((0, exports.dim)("  claude-code-style home for the antigravity cli") + "\n");
    out.write("\n");
}
/** One-line status bar: fits the terminal width, truncated if needed. */
function statusBar(state, cols, extra) {
    const acct = state.accounts.find((a) => a.id === state.activeAccountId) ?? null;
    const dot = state.settings.autoswitch ? (0, exports.green)("●") : (0, exports.gray)("○");
    const who = acct
        ? `${(0, exports.bold)(acct.name)}${acct.plan ? (0, exports.dim)(` ${acct.plan.replace(/^AI\s*/, "")}`) : ""}`
        : (0, exports.dim)("no account");
    const quota = acct?.lastQuota && isFresh(acct.lastQuota.at) ? (0, exports.dim)(` · ${acct.lastQuota.text}`) : "";
    const right = `${state.settings.autoswitch ? (0, exports.dim)("autoswitch on") : (0, exports.dim)("autoswitch off")} ${(0, exports.dim)("·")} ${(0, exports.dim)("/ or ctrl+g")}`;
    const mid = extra ? ` ${(0, exports.yellow)("!")} ${extra}` : "";
    let left = `${dot} ${who}${quota}${mid}`;
    // crude width fit: strip to cols
    const plain = stripAnsi(left + "   " + right);
    if (plain.length > cols) {
        left = `${dot} ${acct ? (0, exports.bold)(acct.name) : (0, exports.dim)("no account")}${mid}`;
    }
    const gap = Math.max(1, cols - stripAnsi(left).length - stripAnsi(right).length);
    return `${left}${" ".repeat(gap)}${right}`;
}
function isFresh(iso) {
    return Date.now() - new Date(iso).getTime() < 6 * 60 * 60 * 1000;
}
function stripAnsi(s) {
    // eslint-disable-next-line no-control-regex
    return s.replace(/\x1b\[[0-9;]*m/g, "");
}
function relTime(v) {
    if (!v)
        return (0, exports.dim)("—");
    const ms = Date.now() - new Date(v).getTime();
    if (ms < 0)
        return (0, exports.dim)("—");
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
/** A clean full-width panel block for flow progress (switch/add). */
function panel(title, lines) {
    const bar = (0, exports.dim)("─".repeat(52));
    return [`\n${bar}`, `${(0, exports.bold)(title)}`, ...lines.map((l) => `  ${l}`), `${bar}\n`].join("\n");
}
function accountLabel(a) {
    const email = a.email ? (0, exports.dim)(` <${a.email}>`) : "";
    const plan = a.plan ? (0, exports.dim)(` · ${a.plan}`) : "";
    return `${(0, exports.bold)(a.name)}${email}${plan}`;
}
exports.HELP_TEXT = `
${(0, exports.bold)("Commands")}  ${(0, exports.dim)("(press / or ctrl+g anywhere — agy never sees these)")}

  ${(0, exports.cyan)("/add")}              Add a Google account via ${(0, exports.bold)("agy auth login")} (stored in OS keyring)
  ${(0, exports.cyan)("/accounts")}         List all accounts with plan, usage and active marker  ${(0, exports.dim)("(alias: /list)")}
  ${(0, exports.cyan)("/usage")}            Remaining quota for all accounts, then live current-account usage from agy
  ${(0, exports.cyan)("/switch")} <name>    Switch account now (tab-completes names, resumes with -c)
  ${(0, exports.cyan)("/autoswitch-on")}    Enable automatic switching when a limit is hit
  ${(0, exports.cyan)("/autoswitch-off")}   Disable automatic switching entirely
  ${(0, exports.cyan)("/handoff")}          Write a handoff.md snapshot on demand (optional, off by default)
  ${(0, exports.cyan)("/help")}             This help

${(0, exports.bold)("Autoswitch")}

  ${(0, exports.green)("ON")}  — on a hard limit (RESOURCE_EXHAUSTED / 429) geminiswitcher takes over
         the screen, swaps the next account's token into the keyring
         (service=gemini, account=antigravity), and relaunches ${(0, exports.bold)("agy -c")}
         in the same directory. No handoff.md unless you enabled it.

  ${(0, exports.yellow)("OFF")} — nothing automatic. No switches, and ${(0, exports.bold)("no handoff.md is ever written")}.
         You stay put until you /switch manually.

${(0, exports.bold)("Context")}  Resume-based: a running agy holds its token in memory, so every
         switch quits agy and relaunches with ${(0, exports.bold)("agy -c")} (or --conversation <id>).
         The dying account is never asked to write a summary.

${(0, exports.bold)("Notes")}    The keyring slot agy reads is machine-wide. Quota figures are
         best-effort observations from agy's own output. Tokens never leave
         this machine. No telemetry.
`.trim();
