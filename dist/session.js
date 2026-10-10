"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Session = void 0;
/* Interactive session: runs agy inside a PTY, intercepts slash commands,
 * scans output for limit signals, and supports quit → swap → relaunch.
 *
 * Input model: stdin is put in raw mode and every keystroke is forwarded to
 * the PTY, except lines that are geminiswitcher slash commands (swallowed and
 * handled locally). A best-effort "shadow" line buffer tracks what the user
 * typed so we can recognise `/command` on Enter. If the shadow ever desyncs
 * (arrow keys, complex editing), we fail safe by forwarding the line to agy.
 */
const string_decoder_1 = require("string_decoder");
const pty = __importStar(require("node-pty"));
const detect_1 = require("./detect");
const accounts_1 = require("./accounts");
const store_1 = require("./store");
const ui_1 = require("./ui");
const OUTPUT_WINDOW = 12_000;
/** Small edit distance for "did you mean …?" on near-miss commands. */
function editDistance(a, b) {
    const dp = Array.from({ length: (a.length + 1) * (b.length + 1) }, () => 0);
    const at = (i, j) => i * (b.length + 1) + j;
    for (let i = 0; i <= a.length; i++)
        dp[at(i, 0)] = i;
    for (let j = 0; j <= b.length; j++)
        dp[at(0, j)] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[at(i, j)] = Math.min(dp[at(i - 1, j)] + 1, dp[at(i, j - 1)] + 1, dp[at(i - 1, j - 1)] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return dp[at(a.length, b.length)];
}
function didYouMean(cmd) {
    let best = null;
    let bestD = 3; // strictly less than 3
    for (const known of detect_1.KNOWN_COMMANDS) {
        const d = editDistance(cmd, known);
        if (d < bestD) {
            bestD = d;
            best = known;
        }
    }
    return best;
}
class Session {
    state;
    agyPath;
    agyArgs;
    cwd;
    cb;
    child = null;
    decoder = new string_decoder_1.StringDecoder("utf8");
    shadow = "";
    shadowDirty = false;
    escBuf = "";
    outputWindow = "";
    expectingRestart = false;
    switching = false; // reentrancy guard for limit handling
    ended = false;
    lastConversationId = null;
    lastLimitAt = 0;
    constructor(state, agyPath, agyArgs, cwd, cb) {
        this.state = state;
        this.agyPath = agyPath;
        this.agyArgs = agyArgs;
        this.cwd = cwd;
        this.cb = cb;
    }
    get activeChild() {
        return this.child;
    }
    get conversationId() {
        return this.lastConversationId;
    }
    get recentOutput() {
        return this.outputWindow;
    }
    /** True while we are inside an automatic switch/restart sequence. */
    get busy() {
        return this.switching;
    }
    set busy(v) {
        this.switching = v;
    }
    /** Spawn agy in a PTY and wire everything up. */
    launch(extraArgs = []) {
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
            env: process.env,
        });
        this.child.onData((data) => this.onPtyData(data));
        this.child.onExit(({ exitCode }) => {
            void this.onPtyExit(exitCode);
        });
    }
    /** Attach stdin interception + resize handling. Call once per session. */
    attach() {
        this.enterRawMode();
        process.stdin.on("data", this.onStdinData);
        process.stdout.on("resize", this.onResize);
        process.on("SIGTERM", this.onSigTerm);
    }
    /** Detach input handling (e.g. before running an external interactive command). */
    detach() {
        process.stdin.off("data", this.onStdinData);
        process.stdout.off("resize", this.onResize);
        process.off("SIGTERM", this.onSigTerm);
        this.exitRawMode();
    }
    /** Permanently end the session (user quit). */
    async end() {
        if (this.ended)
            return;
        this.ended = true;
        this.detach();
        if (this.child) {
            try {
                this.child.kill("SIGKILL");
            }
            catch {
                /* already gone */
            }
            this.child = null;
        }
    }
    /**
     * Kill the running agy so credentials can be swapped, then relaunch.
     * Used by autoswitch, /switch and /add.
     */
    async restart(extraArgs = []) {
        await this.stopChild();
        this.launch(extraArgs);
    }
    /** Kill the running agy WITHOUT relaunching (caller will relaunch later). */
    async stopChild() {
        await this.terminateChild();
    }
    /** Send raw text to agy as if the user typed it (used for /usage forwarding). */
    sendToAgy(text) {
        if (this.child)
            this.child.write(text);
    }
    // ---------------------------------------------------------------- input
    onSigTerm = () => {
        this.exitRawMode();
        process.exit(143);
    };
    onResize = () => {
        if (this.child) {
            try {
                this.child.resize(process.stdout.columns || 80, process.stdout.rows || 30);
            }
            catch {
                /* ignore */
            }
        }
    };
    enterRawMode() {
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
        }
    }
    exitRawMode() {
        try {
            if (process.stdin.isTTY)
                process.stdin.setRawMode(false);
        }
        catch {
            /* ignore */
        }
    }
    onStdinData = (data) => {
        if (!this.child || this.ended)
            return;
        const text = this.decoder.write(data);
        for (const ch of text)
            this.handleKey(ch);
    };
    forward(ch) {
        if (this.child)
            this.child.write(ch);
    }
    handleKey(ch) {
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
                    if (!this.shadowDirty)
                        this.shadow += ch;
                }
                else {
                    // Any other control char may have edited the line in ways we can't track.
                    this.shadowDirty = true;
                }
                this.forward(ch);
                break;
        }
    }
    async submitLine() {
        const line = this.shadowDirty ? "" : this.shadow;
        this.shadow = "";
        this.shadowDirty = false;
        this.escBuf = "";
        const parsed = (0, detect_1.parseSlash)(line);
        if (parsed && detect_1.KNOWN_COMMANDS.has(parsed.cmd)) {
            // Swallow: agy never sees the Enter. Print a newline so our output
            // starts on a fresh line below agy's (still-waiting) prompt.
            process.stdout.write("\n");
            try {
                await this.cb.onSlash(parsed.cmd, parsed.args, line.trim());
            }
            catch (e) {
                (0, ui_1.err)(e instanceof Error ? e.message : String(e));
            }
            return;
        }
        if (parsed && !detect_1.KNOWN_COMMANDS.has(parsed.cmd)) {
            // Not one of ours. If it's a near-miss of a real command, hint;
            // otherwise (paths like /usr/bin, agy's own commands) forward silently.
            const suggestion = didYouMean(parsed.cmd);
            if (suggestion) {
                process.stdout.write("\n");
                (0, ui_1.warn)(`Unknown command "/${parsed.cmd}" — did you mean /${suggestion}? Forwarding to agy…`);
            }
        }
        this.forward("\r");
    }
    // --------------------------------------------------------------- output
    onPtyData(data) {
        process.stdout.write(data);
        this.scanOutput(data);
    }
    scanOutput(data) {
        this.outputWindow = (this.outputWindow + data).slice(-OUTPUT_WINDOW);
        const convId = (0, detect_1.extractConversationId)(data);
        if (convId)
            this.lastConversationId = convId;
        // Best-effort quota/plan learning for /accounts and /usage.
        const acct = (0, accounts_1.activeAccount)(this.state);
        if (acct) {
            const q = (0, detect_1.extractQuotaSignals)(data);
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
                    (0, store_1.saveState)(this.state);
                }
                catch {
                    /* non-fatal */
                }
            }
        }
        const sig = (0, detect_1.detectLimit)(data, this.outputWindow.slice(-4096));
        if (sig.hit && !this.switching && !this.ended) {
            const now = Date.now();
            const cooldown = this.state.settings.limitCooldownMs;
            if (now - this.lastLimitAt < cooldown)
                return;
            this.lastLimitAt = now;
            this.switching = true;
            this.cb
                .onLimit(sig)
                .catch((e) => (0, ui_1.err)(e instanceof Error ? e.message : String(e)))
                .finally(() => {
                this.switching = false;
            });
        }
    }
    async onPtyExit(exitCode) {
        this.child = null;
        if (this.expectingRestart || this.ended)
            return;
        // agy exited on its own — session over.
        await this.end();
        try {
            await this.cb.onEnd(exitCode);
        }
        catch (e) {
            (0, ui_1.err)(e instanceof Error ? e.message : String(e));
        }
    }
    async terminateChild() {
        const child = this.child;
        this.child = null;
        if (!child)
            return;
        this.expectingRestart = true;
        const exited = new Promise((resolve) => {
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
                }
                catch {
                    finish();
                }
            }, 120);
            const force = setTimeout(() => {
                try {
                    child.kill("SIGKILL");
                }
                catch {
                    /* gone */
                }
                // give the SIGKILL a beat, then finish regardless
                setTimeout(finish, 300);
            }, 2500);
        });
        try {
            child.kill("SIGTERM");
        }
        catch {
            /* already gone */
        }
        await exited;
        this.expectingRestart = false;
    }
    /** Print a wrapper line (used by command handlers). */
    print(msg) {
        process.stdout.write(`${(0, ui_1.tag)()} ${msg}\n`);
    }
}
exports.Session = Session;
