/* Application: owns the terminal, the agy session, input routing, the palette,
 * limit handling and all flows. This is what makes geminiswitcher feel like
 * one tool instead of a wrapper.
 */
import { Account, AppPhase, LimitEvent, State } from "./types";
import { VERSION } from "./config";
import { Terminal } from "./terminal";
import { PtyHost } from "./pty_host";
import { InputRouter } from "./input";
import { Palette } from "./palette";
import { LimitDetector, SwitchGuard, extractConversationId } from "./limits";
import { activeAccount, dirAccount, ensureActiveSlot } from "./accounts";
import { saveState } from "./store";
import { commandRegistry, runCommand, CmdEnv } from "./commands";
import { addFlow, switchFlow, writeHandoffFile } from "./flows";
import {
  HELP_TEXT,
  accountLabel,
  banner,
  bold,
  cyan,
  dim,
  err,
  info,
  ok,
  statusBar,
  warn,
  yellow,
} from "./ui";

const OUTPUT_WINDOW = 16_000;

export class Application {
  private term = new Terminal();
  private pty: PtyHost;
  private router: InputRouter;
  private palette: Palette;
  private detector = new LimitDetector();
  private guard: SwitchGuard;
  private phase: AppPhase = "starting";
  private outputWindow = "";
  private lastHardLimitAt = 0;
  private softNotice: string | null = null;
  private doneResolve!: () => void;
  private done = new Promise<void>((r) => (this.doneResolve = r));
  private cmdEnv: CmdEnv;

  constructor(
    private state: State,
    private readonly agyArgs: string[],
    private readonly cwd: string
  ) {
    this.guard = new SwitchGuard(
      state.settings.switchLoopMax,
      state.settings.switchLoopWindowMs
    );
    this.pty = new PtyHost(state.settings.agyPath, agyArgs, cwd, {
      onData: (d) => this.onPtyData(d),
      onExit: (c) => void this.onPtyExit(c),
    });
    this.router = new InputRouter({
      onAgyKey: (ch) => this.pty.write(ch),
      onPaletteOpen: (prefill) => this.openPalette(prefill),
      onPaletteKey: (ch) => this.onPaletteKey(ch),
      onBlockingKey: () => true,
    });
    this.palette = new Palette(this.term, []);
    this.cmdEnv = {
      state,
      switchTo: (a, reason) => this.manualSwitch(a, reason),
      addAccount: () => this.addAccount(),
      setAutoswitch: (on) => this.setAutoswitch(on),
      writeHandoff: (reason) => this.manualHandoff(reason),
      forwardToAgy: (text) => {
        this.pty.write(text);
        this.router.noteExternalSubmit();
      },
      accountNames: (partial) =>
        state.accounts
          .map((a) => a.name)
          .filter((n) => n.toLowerCase().startsWith(partial)),
    };
    // Registry needs env for completion; rebuild once accounts are known.
    this.palette = new Palette(this.term, commandRegistry(this.cmdEnv));
  }

  /* ------------------------------------------------------------ startup */

  async run(): Promise<void> {
    if (!this.term.isTTY) {
      err("geminiswitcher needs an interactive terminal.");
      process.exitCode = 1;
      return;
    }
    this.term.enterRaw();
    this.router.attach();
    this.term.onResize(() => {
      this.pty.resize(this.term.cols, this.term.ptyRows);
      this.refreshStatus();
    });
    this.term.onSigterm(() => {
      this.term.restore();
      process.exit(143);
    });

    // Resolve which account to start on: directory memory wins.
    const remembered = dirAccount(this.state, this.cwd);
    if (remembered && remembered.id !== this.state.activeAccountId) {
      this.state.activeAccountId = remembered.id;
      saveState(this.state);
    }

    const acct = activeAccount(this.state);
    if (!acct) {
      // Shouldn't happen (index handles first-run), but be safe.
      err("No active account. Run with --add to connect one.");
      await this.shutdown();
      return;
    }

    try {
      await ensureActiveSlot(this.state);
    } catch (e) {
      err(e instanceof Error ? e.message : String(e));
      await this.shutdown();
      return;
    }

    this.printStartup(acct, !!remembered);
    this.phase = "ready";
    this.term.reserveStatus();
    this.refreshStatus();
    this.spawnAgy([]);

    await this.done;
    await this.shutdown();
    ok("Bye.");
  }

  private printStartup(acct: Account, remembered: boolean): void {
    banner(VERSION);
    const t = this.term;
    t.writeln(`  ${dim("directory")}   ${this.cwd}`);
    t.writeln(
      `  ${dim("account")}     ${accountLabel(acct)}${remembered ? dim("  (remembered here)") : ""}`
    );
    t.writeln(
      `  ${dim("autoswitch")}  ${this.state.settings.autoswitch ? bold("on") : dim("off")}`
    );
    t.writeln("");
    t.writeln(`  ${dim("press")} ${cyan("/")} ${dim("or")} ${cyan("ctrl+g")} ${dim("for commands · launching agy…")}`);
    t.writeln("");
  }

  private spawnAgy(extraArgs: string[]): void {
    try {
      this.pty.spawn(extraArgs, this.term.cols, this.term.ptyRows);
    } catch (e) {
      err(
        `Could not launch "${this.state.settings.agyPath}": ${e instanceof Error ? e.message : String(e)}. ` +
          `Is agy installed and on your PATH? Override with --agy-path.`
      );
      this.phase = "ended";
      this.doneResolve();
    }
  }

  /* ------------------------------------------------------- PTY handling */

  private onPtyData(data: string): void {
    this.term.write(data);
    this.outputWindow = (this.outputWindow + data).slice(-OUTPUT_WINDOW);
    const cid = extractConversationId(data);
    if (cid) this.conversationId = cid;
    // Quota learning for /accounts and /usage.
    this.learnQuota(data);
    const ev = this.detector.scan(data);
    if (ev) void this.onLimitEvent(ev);
  }

  private learnQuota(data: string): void {
    const acct = activeAccount(this.state);
    if (!acct) return;
    const planM =
      data.match(/google\s*ai\s*(pro|plus|ultra)/i) || data.match(/\bAI\s*(Pro|Plus|Ultra)\b/);
    const qM =
      data.match(/(\d{1,3})\s*%\s*(remaining|left|available)/i) ||
      data.match(/(remaining|left)[^\n]{0,50}?(\d{1,3})\s*%/i);
    let touched = false;
    if (planM) {
      const plan = `AI ${planM[1][0].toUpperCase()}${planM[1].slice(1).toLowerCase()}`;
      if (acct.plan !== plan) {
        acct.plan = plan;
        touched = true;
      }
    }
    if (qM) {
      const pct = /^\d+$/.test(qM[1]) ? qM[1] : qM[2];
      acct.lastQuota = { text: `${pct}% remaining`, at: new Date().toISOString() };
      touched = true;
    }
    if (touched) {
      try {
        saveState(this.state);
      } catch {
        /* non-fatal */
      }
      this.refreshStatus();
    }
  }

  private async onPtyExit(code: number): Promise<void> {
    if (this.pty.expectedExit || this.phase === "switching" || this.phase === "adding") {
      return; // we initiated this; a relaunch is coming (or already happened)
    }
    if (this.phase === "ended") return;
    this.phase = "ended";
    this.term.writeln("");
    info(`agy exited (code ${code}). Run ${cyan("geminiswitcher")} to start again.`);
    this.doneResolve();
  }

  /* --------------------------------------------------- limit handling */

  private async onLimitEvent(ev: LimitEvent): Promise<void> {
    if (this.phase !== "ready") return;
    const acct = activeAccount(this.state);
    const who = acct ? `"${acct.name}"` : "the current account";

    if (ev.kind === "soft") {
      this.softNotice = ev.signal;
      this.refreshStatus();
      info(dim(`Heads up: ${who} — ${ev.signal}. Autoswitch will fire on a hard limit.`));
      setTimeout(() => {
        this.softNotice = null;
        this.refreshStatus();
      }, 30_000);
      return;
    }

    // Hard limit.
    const now = Date.now();
    if (now - this.lastHardLimitAt < this.state.settings.limitCooldownMs) return;
    this.lastHardLimitAt = now;

    if (!this.state.settings.autoswitch) {
      warn(
        `Hard limit on ${who} (${ev.signal}) — autoswitch is ${yellow("off")}. ` +
          `Staying put. ${cyan("/switch <name>")} to move manually.`
      );
      return;
    }

    if (this.guard.tripped()) {
      this.setAutoswitch(false);
      err(
        `Limit storm: ${this.guard.count()} automatic switches recently. ` +
          `Paused autoswitch to protect your accounts — ${cyan("/autoswitch-on")} to resume, ` +
          `or ${cyan("/switch <name>")} to move manually.`
      );
      return;
    }

    this.phase = "switching";
    this.refreshStatus("switching…");
    const ctx = this.flowContext();
    const switched = await switchFlow(ctx, null, `limit on ${who}`, ev.signal);
    this.guard.record();
    // Fresh output window so the old error can't retrigger.
    this.outputWindow = "";
    this.phase = "ready";
    this.refreshStatus();
    if (!switched) {
      warn("Stayed on the current account.");
    }
  }

  /* ------------------------------------------------------------ palette */

  private openPalette(prefill: string): void {
    if (this.phase !== "ready" || this.palette.isOpen) return;
    this.router.setMode("palette");
    // Rebuild registry so account completion is current.
    this.palette = new Palette(this.term, commandRegistry(this.cmdEnv));
    this.palette.open(prefill);
  }

  private async onPaletteKey(ch: string): Promise<void> {
    const outcome = this.palette.handleKey(ch);
    if (outcome === "done" && this.palette.result) {
      const { cmd, args } = this.palette.result;
      this.router.setMode("agy");
      this.term.write("\n");
      try {
        await runCommand(cmd, args, this.cmdEnv);
      } catch (e) {
        err(e instanceof Error ? e.message : String(e));
      }
      this.refreshStatus();
    } else if (outcome === "cancelled") {
      this.router.setMode("agy");
      this.refreshStatus();
    }
    // "open" → keep going
  }

  /* ------------------------------------------------------------ commands */

  private async manualSwitch(account: Account, reason: string): Promise<void> {
    if (this.phase !== "ready") {
      warn("A flow is already running — hold on.");
      return;
    }
    this.phase = "switching";
    this.refreshStatus("switching…");
    await switchFlow(this.flowContext(), account, reason);
    this.outputWindow = "";
    this.phase = "ready";
    this.refreshStatus();
  }

  private async addAccount(): Promise<void> {
    if (this.phase !== "ready") {
      warn("A flow is already running — hold on.");
      return;
    }
    this.phase = "adding";
    this.refreshStatus("adding account…");
    await addFlow(this.flowContext(), this.pty.alive);
    this.outputWindow = "";
    this.phase = "ready";
    this.refreshStatus();
  }

  private setAutoswitch(on: boolean): void {
    this.state.settings.autoswitch = on;
    saveState(this.state);
    if (on) this.guard.reset();
    this.refreshStatus();
  }

  private manualHandoff(reason: string): void {
    const acct = activeAccount(this.state);
    if (!acct) {
      err("No active account — nothing to snapshot.");
      return;
    }
    writeHandoffFile(this.flowContext(), acct, acct, reason);
  }

  /* -------------------------------------------------------------- misc */

  private flowContext() {
    return {
      term: this.term,
      pty: this.pty,
      state: this.state,
      cwd: this.cwd,
      router: this.router,
      refreshStatus: (extra?: string) => this.refreshStatus(extra),
      recentOutput: () => this.outputWindow,
      conversationId: () => this.conversationId,
    };
  }

  private conversationId: string | null = null;

  private refreshStatus(extra?: string): void {
    if (this.phase === "ended") return;
    const note = extra ?? this.softNotice ?? undefined;
    this.term.renderStatus(statusBar(this.state, this.term.cols, note ?? undefined));
  }

  private async shutdown(): Promise<void> {
    if (this.phase !== "ended") this.phase = "ended";
    this.router.detach();
    this.pty.killNow();
    this.term.restore();
  }

  printHelp(): void {
    process.stdout.write(HELP_TEXT + "\n");
  }
}
