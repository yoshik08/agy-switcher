"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InputRouter = void 0;
/* Input routing with explicit modes.
 *
 *   agy      — keystrokes go to the agy PTY. We track a best-effort line
 *              buffer; a "/" typed on an empty line (or Ctrl+G anywhere)
 *              opens the command palette instead of reaching agy.
 *   palette  — keystrokes go to the palette's line editor.
 *   blocking — a flow (switch/add) owns the screen; most keys are swallowed,
 *              Ctrl+C cancels where the flow allows it.
 *
 * If line tracking ever desyncs (fancy editing in agy), the worst case is a
 * missed "/" — the user still has Ctrl+G. Nothing is ever misrouted silently.
 */
const string_decoder_1 = require("string_decoder");
const PALETTE_KEYS = new Set(["\x07"]); // Ctrl+G
class InputRouter {
    events;
    mode = "agy";
    decoder = new string_decoder_1.StringDecoder("utf8");
    line = "";
    lineTrusted = true;
    esc = "";
    constructor(events) {
        this.events = events;
    }
    get current() {
        return this.mode;
    }
    setMode(m) {
        this.mode = m;
        if (m === "agy") {
            this.line = "";
            this.lineTrusted = true;
            this.esc = "";
        }
    }
    attach() {
        process.stdin.on("data", this.onData);
    }
    detach() {
        process.stdin.off("data", this.onData);
    }
    onData = (data) => {
        const text = this.decoder.write(data);
        for (const ch of text)
            this.handleKey(ch);
    };
    /** Route a single keystroke. Public for testing. */
    handleKey(ch) {
        this.route(ch);
    }
    route(ch) {
        if (this.mode === "palette") {
            this.events.onPaletteKey(ch);
            return;
        }
        if (this.mode === "blocking") {
            if (!this.events.onBlockingKey(ch)) {
                // default: swallow quietly (flow owns the screen)
            }
            return;
        }
        this.routeAgy(ch);
    }
    routeAgy(ch) {
        // Escape sequences (arrows etc.): forward, distrust the line buffer.
        if (this.esc) {
            this.esc += ch;
            this.events.onAgyKey(ch);
            if (/[a-zA-Z~]/.test(ch)) {
                this.esc = "";
                this.lineTrusted = false;
            }
            return;
        }
        if (ch === "\x1b") {
            this.esc = ch;
            this.events.onAgyKey(ch);
            return;
        }
        if (PALETTE_KEYS.has(ch)) {
            this.events.onPaletteOpen("/");
            return;
        }
        switch (ch) {
            case "\r":
            case "\n":
                this.line = "";
                this.lineTrusted = true;
                this.events.onAgyKey(ch === "\n" ? "\r" : ch);
                return;
            case "\x7f":
                if (this.lineTrusted && this.line.length > 0)
                    this.line = this.line.slice(0, -1);
                this.events.onAgyKey(ch);
                return;
            case "\x03": // Ctrl+C
            case "\x15": // Ctrl+U
                this.line = "";
                this.lineTrusted = true;
                this.events.onAgyKey(ch);
                return;
            default:
                break;
        }
        // "/" on a trusted-empty line opens the palette (swallowed, prefilled).
        if (ch === "/" && this.lineTrusted && this.line === "") {
            this.events.onPaletteOpen("/");
            return;
        }
        if (ch >= " " || ch === "\t") {
            if (this.lineTrusted)
                this.line += ch;
        }
        else if (ch !== "\x04" && ch !== "\x0c") {
            this.lineTrusted = false;
        }
        this.events.onAgyKey(ch);
    }
    /** The app calls this when it submits a line to agy by other means. */
    noteExternalSubmit() {
        this.line = "";
        this.lineTrusted = true;
    }
}
exports.InputRouter = InputRouter;
