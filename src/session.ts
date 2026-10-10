/* Interactive session: runs agy inside a PTY, intercepts slash commands,
 * scans output for limit signals, and supports quit → swap → relaunch.
 *
 * Input model: stdin is put in raw mode and every keystroke is forwarded to
 * the PTY, except lines that are geminiswitcher slash commands (swallowed and
 * handled locally). A best-effort "shadow" line buffer tracks what the user
 * typed so we can recognise `/command` on Enter. If the shadow ever desyncs
 * (arrow keys, complex editing), we fail safe by forwarding the line to agy.
 */
import { StringDecoder } from "string_decoder";
import * as pty from "node-pty";
import { LimitSignal, State } from "./types";
import { detectLimit, extractConversationId, extractQuotaSignals, KNOWN_COMMANDS, parseSlash } from "./detect";
import { activeAccount } from "./accounts";
import { saveState } from "./store";
import { err, tag, warn } from "./ui";

export interface SessionCallbacks {
  /** A swallowed slash command line, e.g. "/switch work". */
  onSlash: (cmd: string, args: string[], rawLine: string) => Promise<void>;
  /** A limit signal was seen in agy output. */
  onLimit: (signal: LimitSignal) => Promise<void>;
  /** agy exited on its own (not via our restart). Session is over. */
  onEnd: (exitCode: number) => Promise<void>;
}

const OUTPUT_WINDOW = 12_000;

/** Small edit distance for "did you mean …?" on near-miss commands. */
function editDistance(a: string, b: string): number {
  const dp: number[] = Array.from({ length: (a.length + 1) * (b.length + 1) }, () => 0);
  const at = (i: number, j: number) => i * (b.length + 1) + j;
  for (let i = 0; i <= a.length; i++) dp[at(i, 0)] = i;
  for (let j = 0; j <= b.length; j++) dp[at(0, j)] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[at(i, j)] = Math.min(
        dp[at(i - 1, j)] + 1,
        dp[at(i, j - 1)] + 1,
        dp[at(i - 1, j - 1)] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[at(a.length, b.length)];
}

function didYouMean(cmd: string): string | null {
  let best: string | null = null;
  let bestD = 3; // strictly less than 3
  for (const known of KNOWN_COMMANDS) {
    const d = editDistance(cmd, known);
    if (d < bestD) {
      bestD = d;
      best = known;
    }
  }
  return best;
}

export class Session {
  private child: pty.IPty | null = null;
  private decoder = new StringDecoder("utf8");
  private shadow = "";
  private shadowDirty = false;
  private escBuf = "";
  private outputWindow = "";
  private expectingRestart = false;
  private switching = false; // reentrancy guard for limit handling
  private ended = false;
  private lastConversationId: string | null = null;
  private lastLimitAt = 0;

  constructor(
    public state: State,
    public readonly agyPath: string,
    public readonly agyArgs: string[],
    public readonly cwd: string,
    private cb: SessionCallbacks
  ) {}

  get activeChild(): pty.IPty | null {
    return this.child;
  }

  get conversationId(): string | null {
    return this.lastConversationId;
  }

  get recentOutput(): string {
    return this.outputWindow;
  }

  /** True while we are inside an automatic switch/restart sequence. */
  get busy(): boolean {
    return this.switching;
  }

  set busy(v: boolean) {
    this.switching = v;
  }

  /** Spawn agy in a PTY and wire everything up. */
  launch(extraArgs: string[] = []): void {
    const args = [...this.agyArgs, ...extraArgs];
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 30;
    this.expectingRestart = false;
    // Fresh output window per process: stale error text from a previous
    // incarnation must not re-trigger limit detection after a restart.
    this.outputWindow = "";
    this.shadow = "";
    this.shadowDirty = false;
    this.escBuf = "";
    this.child = pty.spawn(this.agyPath, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: this.cwd,
      env: process.env as Record<string, string>,
    });
    this.child.onData((data: string) => this.onPtyData(data));
    this.child.onExit(({ exitCode }) => {
      void this.onPtyExit(exitCode);
    });
  }

  /** Attach stdin interception + resize handling. Call once per session. */
  attach(): void {
    this.enterRawMode();
    process.stdin.on("data", this.onStdinData);
    process.stdout.on("resize", this.onResize);
    process.on("SIGTERM", this.onSigTerm);
  }

  /** Detach input handling (e.g. before running an external interactive command). */
  detach(): void {
    process.stdin.off("data", this.onStdinData);
    process.stdout.off("resize", this.onResize);
    process.off("SIGTERM", this.onSigTerm);
    this.exitRawMode();
  }

  /** Permanently end the session (user quit). */
  async end(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.detach();
    if (this.child) {
      try {
        this.child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      this.child = null;
    }
  }

  /**
   * Kill the running agy so credentials can be swapped, then relaunch.
   * Used by autoswitch, /switch and /add.
   */
  async restart(extraArgs: string[] = []): Promise<void> {
    await this.stopChild();
    this.launch(extraArgs);
  }

  /** Kill the running agy WITHOUT relaunching (caller will relaunch later). */
  async stopChild(): Promise<void> {
    await this.terminateChild();
  }

  /** Send raw text to agy as if the user typed it (used for /usage forwarding). */
  sendToAgy(text: string): void {
    if (this.child) this.child.write(text);
  }

  // ---------------------------------------------------------------- input

  private onSigTerm = (): void => {
    this.exitRawMode();
    process.exit(143);
  };

  private onResize = (): void => {
    if (this.child) {
      try {
        this.child.resize(process.stdout.columns || 80, process.stdout.rows || 30);
      } catch {
        /* ignore */
      }
    }
  };

  private enterRawMode(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }
  }

  private exitRawMode(): void {
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {
      /* ignore */
    }
  }

  private onStdinData = (data: Buffer): void => {
    if (!this.child || this.ended) return;
    const text = this.decoder.write(data);
    for (const ch of text) this.handleKey(ch);
  };

  private forward(ch: string): void {
    if (this.child) this.child.write(ch);
  }

  private handleKey(ch: string): void {
    // Inside an escape sequence (arrow keys, etc.): forward verbatim, mark shadow untrusted.
    if (this.escBuf) {
      this.escBuf += ch;
      this.forward(ch);
      if (/[a-zA-Z~]/.test(ch)) {
        this.escBuf = "";
        this.shadowDirty = true;
      }
      return;
    }
    if (ch === "\x1b") {
      this.escBuf = ch;
      this.forward(ch);
      return;
    }
    switch (ch) {
      case "\r":
      case "\n":
        void this.submitLine();
        break;
      case "\x7f": // backspace
        if (!this.shadowDirty && this.shadow.length > 0) {
          this.shadow = this.shadow.slice(0, -1);
        }
        this.forward(ch);
        break;
      case "\x03": // Ctrl-C
        this.shadow = "";
        this.shadowDirty = false;
        this.forward(ch);
        break;
      case "\x15": // Ctrl-U (kill line)
        this.shadow = "";
        this.shadowDirty = false;
        this.forward(ch);
        break;
      case "\x04": // Ctrl-D
        this.forward(ch);
        break;
      case "\x0c": // Ctrl-L — let agy redraw; shadow stays valid (no edit)
        this.forward(ch);
        break;
      default:
        if (ch >= " " || ch === "\t") {
          if (!this.shadowDirty) this.shadow += ch;
        } else {
          // Any other control char may have edited the line in ways we can't track.
          this.shadowDirty = true;
        }
        this.forward(ch);
        break;
    }
  }

  private async submitLine(): Promise<void> {
    const line = this.shadowDirty ? "" : this.shadow;
    this.shadow = "";
    this.shadowDirty = false;
    this.escBuf = "";

    const parsed = parseSlash(line);
    if (parsed && KNOWN_COMMANDS.has(parsed.cmd)) {
      // Swallow: agy never sees the Enter. Print a newline so our output
      // starts on a fresh line below agy's (still-waiting) prompt.
      process.stdout.write("\n");
      try {
        await this.cb.onSlash(parsed.cmd, parsed.args, line.trim());
      } catch (e) {
        err(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (parsed && !KNOWN_COMMANDS.has(parsed.cmd)) {
      // Not one of ours. If it's a near-miss of a real command, hint;
      // otherwise (paths like /usr/bin, agy's own commands) forward silently.
      const suggestion = didYouMean(parsed.cmd);
      if (suggestion) {
        process.stdout.write("\n");
        warn(`Unknown command "/${parsed.cmd}" — did you mean /${suggestion}? Forwarding to agy…`);
      }
    }
    this.forward("\r");
  }

  // --------------------------------------------------------------- output

  private onPtyData(data: string): void {
    process.stdout.write(data);
    this.scanOutput(data);
  }

  private scanOutput(data: string): void {
    this.outputWindow = (this.outputWindow + data).slice(-OUTPUT_WINDOW);

    const convId = extractConversationId(data);
    if (convId) this.lastConversationId = convId;

    // Best-effort quota/plan learning for /accounts and /usage.
    const acct = activeAccount(this.state);
    if (acct) {
      const q = extractQuotaSignals(data);
      let touched = false;
      if (q.plan && acct.plan !== q.plan) {
        acct.plan = q.plan;
        touched = true;
      }
      if (q.quotaText) {
        acct.lastQuota = { text: q.quotaText, at: new Date().toISOString() };
        touched = true;
      }
      if (touched) {
        try {
          saveState(this.state);
        } catch {
          /* non-fatal */
        }
      }
    }

    const sig = detectLimit(data, this.outputWindow.slice(-4096));
    if (sig.hit && !this.switching && !this.ended) {
      const now = Date.now();
      const cooldown = this.state.settings.limitCooldownMs;
      if (now - this.lastLimitAt < cooldown) return;
      this.lastLimitAt = now;
      this.switching = true;
      this.cb
        .onLimit(sig)
        .catch((e) => err(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          this.switching = false;
        });
    }
  }

  private async onPtyExit(exitCode: number): Promise<void> {
    this.child = null;
    if (this.expectingRestart || this.ended) return;
    // agy exited on its own — session over.
    await this.end();
    try {
      await this.cb.onEnd(exitCode);
    } catch (e) {
      err(e instanceof Error ? e.message : String(e));
    }
  }

  private async terminateChild(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child) return;
    this.expectingRestart = true;
    const exited = new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          clearInterval(probe);
          clearTimeout(force);
          resolve();
        }
      };
      // Poll: once kill() throws, the process is gone.
      const probe = setInterval(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          finish();
        }
      }, 120);
      const force = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* gone */
        }
        // give the SIGKILL a beat, then finish regardless
        setTimeout(finish, 300);
      }, 2500);
    });
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    await exited;
    this.expectingRestart = false;
  }

  /** Print a wrapper line (used by command handlers). */
  print(msg: string): void {
    process.stdout.write(`${tag()} ${msg}\n`);
  }
}
