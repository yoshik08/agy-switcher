"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Application = void 0;
const config_1 = require("./config");
const terminal_1 = require("./terminal");
const pty_host_1 = require("./pty_host");
const input_1 = require("./input");
const palette_1 = require("./palette");
const limits_1 = require("./limits");
const accounts_1 = require("./accounts");
const store_1 = require("./store");
const commands_1 = require("./commands");
const flows_1 = require("./flows");
const ui_1 = require("./ui");
const OUTPUT_WINDOW = 16_000;
class Application {
    state;
    agyArgs;
    cwd;
    term = new terminal_1.Terminal();
    pty;
    router;
    palette;
    detector = new limits_1.LimitDetector();
    guard;
    phase = "starting";
    outputWindow = "";
    lastHardLimitAt = 0;
    softNotice = null;
    doneResolve;
    done = new Promise((r) => (this.doneResolve = r));
    cmdEnv;
    constructor(state, agyArgs, cwd) {
        this.state = state;
        this.agyArgs = agyArgs;
        this.cwd = cwd;
        this.guard = new limits_1.SwitchGuard(state.settings.switchLoopMax, state.settings.switchLoopWindowMs);
        this.pty = new pty_host_1.PtyHost(state.settings.agyPath, agyArgs, cwd, {
            onData: (d) => this.onPtyData(d),
            onExit: (c) => void this.onPtyExit(c),
        });
        this.router = new input_1.InputRouter({
            onAgyKey: (ch) => this.pty.write(ch),
            onPaletteOpen: (prefill) => this.openPalette(prefill),
            onPaletteKey: (ch) => this.onPaletteKey(ch),
            onBlockingKey: () => true,
        });
        this.palette = new palette_1.Palette(this.term, []);
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
            accountNames: (partial) => state.accounts
                .map((a) => a.name)
                .filter((n) => n.toLowerCase().startsWith(partial)),
        };
        // Registry needs env for completion; rebuild once accounts are known.
        this.palette = new palette_1.Palette(this.term, (0, commands_1.commandRegistry)(this.cmdEnv));
    }
    /* ------------------------------------------------------------ startup */
    async run() {
        if (!this.term.isTTY) {
            (0, ui_1.err)("geminiswitcher needs an interactive terminal.");
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
        const remembered = (0, accounts_1.dirAccount)(this.state, this.cwd);
        if (remembered && remembered.id !== this.state.activeAccountId) {
            this.state.activeAccountId = remembered.id;
            (0, store_1.saveState)(this.state);
        }
        const acct = (0, accounts_1.activeAccount)(this.state);
        if (!acct) {
            // Shouldn't happen (index handles first-run), but be safe.
            (0, ui_1.err)("No active account. Run with --add to connect one.");
            await this.shutdown();
            return;
        }
        try {
            await (0, accounts_1.ensureActiveSlot)(this.state);
        }
        catch (e) {
            (0, ui_1.err)(e instanceof Error ? e.message : String(e));
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
        (0, ui_1.ok)("Bye.");
    }
    printStartup(acct, remembered) {
        (0, ui_1.banner)(config_1.VERSION);
        const t = this.term;
        t.writeln(`  ${(0, ui_1.dim)("directory")}   ${this.cwd}`);
        t.writeln(`  ${(0, ui_1.dim)("account")}     ${(0, ui_1.accountLabel)(acct)}${remembered ? (0, ui_1.dim)("  (remembered here)") : ""}`);
        t.writeln(`  ${(0, ui_1.dim)("autoswitch")}  ${this.state.settings.autoswitch ? (0, ui_1.bold)("on") : (0, ui_1.dim)("off")}`);
        t.writeln("");
        t.writeln(`  ${(0, ui_1.dim)("press")} ${(0, ui_1.cyan)("/")} ${(0, ui_1.dim)("or")} ${(0, ui_1.cyan)("ctrl+g")} ${(0, ui_1.dim)("for commands · launching agy…")}`);
        t.writeln("");
    }
    spawnAgy(extraArgs) {
        try {
            this.pty.spawn(extraArgs, this.term.cols, this.term.ptyRows);
        }
        catch (e) {
            (0, ui_1.err)(`Could not launch "${this.state.settings.agyPath}": ${e instanceof Error ? e.message : String(e)}. ` +
                `Is agy installed and on your PATH? Override with --agy-path.`);
            this.phase = "ended";
            this.doneResolve();
        }
    }
    /* ------------------------------------------------------- PTY handling */
    onPtyData(data) {
        this.term.write(data);
        this.outputWindow = (this.outputWindow + data).slice(-OUTPUT_WINDOW);
        const cid = (0, limits_1.extractConversationId)(data);
        if (cid)
            this.conversationId = cid;
        // Quota learning for /accounts and /usage.
        this.learnQuota(data);
        const ev = this.detector.scan(data);
        if (ev)
            void this.onLimitEvent(ev);
    }
    learnQuota(data) {
        const acct = (0, accounts_1.activeAccount)(this.state);
        if (!acct)
            return;
        const planM = data.match(/google\s*ai\s*(pro|plus|ultra)/i) || data.match(/\bAI\s*(Pro|Plus|Ultra)\b/);
        const qM = data.match(/(\d{1,3})\s*%\s*(remaining|left|available)/i) ||
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
                (0, store_1.saveState)(this.state);
            }
            catch {
                /* non-fatal */
            }
            this.refreshStatus();
        }
    }
    async onPtyExit(code) {
        if (this.pty.expectedExit || this.phase === "switching" || this.phase === "adding") {
            return; // we initiated this; a relaunch is coming (or already happened)
        }
        if (this.phase === "ended")
            return;
        this.phase = "ended";
        this.term.writeln("");
        (0, ui_1.info)(`agy exited (code ${code}). Run ${(0, ui_1.cyan)("geminiswitcher")} to start again.`);
        this.doneResolve();
    }
    /* --------------------------------------------------- limit handling */
    async onLimitEvent(ev) {
        if (this.phase !== "ready")
            return;
        const acct = (0, accounts_1.activeAccount)(this.state);
        const who = acct ? `"${acct.name}"` : "the current account";
        if (ev.kind === "soft") {
            this.softNotice = ev.signal;
            this.refreshStatus();
            (0, ui_1.info)((0, ui_1.dim)(`Heads up: ${who} — ${ev.signal}. Autoswitch will fire on a hard limit.`));
            setTimeout(() => {
                this.softNotice = null;
                this.refreshStatus();
            }, 30_000);
            return;
        }
        // Hard limit.
        const now = Date.now();
        if (now - this.lastHardLimitAt < this.state.settings.limitCooldownMs)
            return;
        this.lastHardLimitAt = now;
        if (!this.state.settings.autoswitch) {
            (0, ui_1.warn)(`Hard limit on ${who} (${ev.signal}) — autoswitch is ${(0, ui_1.yellow)("off")}. ` +
                `Staying put. ${(0, ui_1.cyan)("/switch <name>")} to move manually.`);
            return;
        }
        if (this.guard.tripped()) {
            this.setAutoswitch(false);
            (0, ui_1.err)(`Limit storm: ${this.guard.count()} automatic switches recently. ` +
                `Paused autoswitch to protect your accounts — ${(0, ui_1.cyan)("/autoswitch-on")} to resume, ` +
                `or ${(0, ui_1.cyan)("/switch <name>")} to move manually.`);
            return;
        }
        this.phase = "switching";
        this.refreshStatus("switching…");
        const ctx = this.flowContext();
        const switched = await (0, flows_1.switchFlow)(ctx, null, `limit on ${who}`, ev.signal);
        this.guard.record();
        // Fresh output window so the old error can't retrigger.
        this.outputWindow = "";
        this.phase = "ready";
        this.refreshStatus();
        if (!switched) {
            (0, ui_1.warn)("Stayed on the current account.");
        }
    }
    /* ------------------------------------------------------------ palette */
    openPalette(prefill) {
        if (this.phase !== "ready" || this.palette.isOpen)
            return;
        this.router.setMode("palette");
        // Rebuild registry so account completion is current.
        this.palette = new palette_1.Palette(this.term, (0, commands_1.commandRegistry)(this.cmdEnv));
        this.palette.open(prefill);
    }
    async onPaletteKey(ch) {
        const outcome = this.palette.handleKey(ch);
        if (outcome === "done" && this.palette.result) {
            const { cmd, args } = this.palette.result;
            this.router.setMode("agy");
            this.term.write("\n");
            try {
                await (0, commands_1.runCommand)(cmd, args, this.cmdEnv);
            }
            catch (e) {
                (0, ui_1.err)(e instanceof Error ? e.message : String(e));
            }
            this.refreshStatus();
        }
        else if (outcome === "cancelled") {
            this.router.setMode("agy");
            this.refreshStatus();
        }
        // "open" → keep going
    }
    /* ------------------------------------------------------------ commands */
    async manualSwitch(account, reason) {
        if (this.phase !== "ready") {
            (0, ui_1.warn)("A flow is already running — hold on.");
            return;
        }
        this.phase = "switching";
        this.refreshStatus("switching…");
        await (0, flows_1.switchFlow)(this.flowContext(), account, reason);
        this.outputWindow = "";
        this.phase = "ready";
        this.refreshStatus();
    }
    async addAccount() {
        if (this.phase !== "ready") {
            (0, ui_1.warn)("A flow is already running — hold on.");
            return;
        }
        this.phase = "adding";
        this.refreshStatus("adding account…");
        await (0, flows_1.addFlow)(this.flowContext(), this.pty.alive);
        this.outputWindow = "";
        this.phase = "ready";
        this.refreshStatus();
    }
    setAutoswitch(on) {
        this.state.settings.autoswitch = on;
        (0, store_1.saveState)(this.state);
        if (on)
            this.guard.reset();
        this.refreshStatus();
    }
    manualHandoff(reason) {
        const acct = (0, accounts_1.activeAccount)(this.state);
        if (!acct) {
            (0, ui_1.err)("No active account — nothing to snapshot.");
            return;
        }
        (0, flows_1.writeHandoffFile)(this.flowContext(), acct, acct, reason);
    }
    /* -------------------------------------------------------------- misc */
    flowContext() {
        return {
            term: this.term,
            pty: this.pty,
            state: this.state,
            cwd: this.cwd,
            router: this.router,
            refreshStatus: (extra) => this.refreshStatus(extra),
            recentOutput: () => this.outputWindow,
            conversationId: () => this.conversationId,
        };
    }
    conversationId = null;
    refreshStatus(extra) {
        if (this.phase === "ended")
            return;
        const note = extra ?? this.softNotice ?? undefined;
        this.term.renderStatus((0, ui_1.statusBar)(this.state, this.term.cols, note ?? undefined));
    }
    async shutdown() {
        if (this.phase !== "ended")
            this.phase = "ended";
        this.router.detach();
        this.pty.killNow();
        this.term.restore();
    }
    printHelp() {
        process.stdout.write(ui_1.HELP_TEXT + "\n");
    }
}
exports.Application = Application;
