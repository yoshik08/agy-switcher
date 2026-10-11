"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Palette = void 0;
const ui_1 = require("./ui");
const PANEL_MATCHES = 5;
function fuzzyScore(query, target) {
    // Subsequence match; lower score = better (earlier + more compact).
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    let ti = 0;
    let score = 0;
    let last = -1;
    for (const qc of q) {
        const idx = t.indexOf(qc, ti);
        if (idx === -1)
            return null;
        score += idx - last - 1;
        if (idx === 0)
            score -= 2; // prefix bonus
        last = idx;
        ti = idx + 1;
    }
    return score;
}
class Palette {
    term;
    commands;
    active = false;
    buf = "";
    cursor = 0;
    sel = 0;
    matches = [];
    drawnLines = 0;
    _result = null;
    constructor(term, commands) {
        this.term = term;
        this.commands = commands;
    }
    get result() {
        return this._result;
    }
    get isOpen() {
        return this.active;
    }
    open(prefill) {
        this.active = true;
        this.buf = prefill;
        this.cursor = prefill.length;
        this.sel = 0;
        this._result = null;
        this.refilter();
        this.draw();
    }
    handleKey(ch) {
        if (!this.active)
            return "open";
        switch (ch) {
            case "\x1b": // Esc
                this.cancel();
                return "cancelled";
            case "\x03": // Ctrl+C
                this.cancel();
                return "cancelled";
            case "\r":
            case "\n":
                return this.submit();
            case "\x7f": // backspace
                if (this.cursor > 0) {
                    this.buf = this.buf.slice(0, this.cursor - 1) + this.buf.slice(this.cursor);
                    this.cursor--;
                    this.sel = 0;
                    this.refilter();
                    this.draw();
                }
                return "open";
            case "\t": // Tab: complete
                this.tabComplete();
                return "open";
            case "\x15": // Ctrl+U: clear
                this.buf = "";
                this.cursor = 0;
                this.sel = 0;
                this.refilter();
                this.draw();
                return "open";
            default:
                break;
        }
        // Up/Down arrive as escape sequences; the router forwards them raw only in
        // agy mode. In palette mode we get here only for single chars, so handle
        // Ctrl+P / Ctrl+N as up/down.
        if (ch === "\x10") {
            this.sel = Math.max(0, this.sel - 1);
            this.draw();
            return "open";
        }
        if (ch === "\x0e") {
            this.sel = Math.min(this.matches.length - 1, this.sel + 1);
            this.draw();
            return "open";
        }
        if (ch >= " " && ch !== "\x7f") {
            this.buf = this.buf.slice(0, this.cursor) + ch + this.buf.slice(this.cursor);
            this.cursor++;
            this.sel = 0;
            this.refilter();
            this.draw();
        }
        return "open";
    }
    query() {
        return this.buf.startsWith("/") ? this.buf.slice(1) : this.buf;
    }
    refilter() {
        const q = this.query().split(/\s+/)[0] ?? "";
        const scored = this.commands
            .map((c) => ({ c, s: q === "" ? 0 : fuzzyScore(q, c.name) }))
            .filter((x) => x.s !== null)
            .sort((a, b) => a.s - b.s);
        this.matches = scored.map((x) => x.c).slice(0, PANEL_MATCHES);
        this.sel = Math.min(this.sel, Math.max(0, this.matches.length - 1));
    }
    tabComplete() {
        const q = this.query();
        const parts = q.split(/\s+/);
        if (parts.length <= 1) {
            // Complete the command name.
            const m = this.matches[this.sel];
            if (m) {
                this.buf = "/" + m.name + " ";
                this.cursor = this.buf.length;
                this.refilter();
                this.draw();
            }
            return;
        }
        // Complete the argument (e.g. account name for /switch).
        const cmdName = parts[0].toLowerCase();
        const def = this.commands.find((c) => c.name === cmdName);
        const partial = parts[parts.length - 1];
        if (def?.completeArg) {
            const opts = def.completeArg(partial);
            if (opts.length === 1) {
                parts[parts.length - 1] = opts[0];
                this.buf = "/" + parts.join(" ");
                this.cursor = this.buf.length;
                this.draw();
            }
            else if (opts.length > 1) {
                // Complete the shared prefix.
                let prefix = opts[0];
                for (const o of opts.slice(1)) {
                    let i = 0;
                    while (i < prefix.length && i < o.length && prefix[i] === o[i])
                        i++;
                    prefix = prefix.slice(0, i);
                }
                if (prefix.length > partial.length) {
                    parts[parts.length - 1] = prefix;
                    this.buf = "/" + parts.join(" ");
                    this.cursor = this.buf.length;
                    this.draw();
                }
            }
        }
    }
    submit() {
        let text = this.buf.trim();
        if (text === "" || text === "/") {
            const m = this.matches[this.sel];
            if (!m) {
                this.cancel();
                return "cancelled";
            }
            text = "/" + m.name;
        }
        if (!text.startsWith("/"))
            text = "/" + text;
        const parts = text.slice(1).split(/\s+/).filter(Boolean);
        if (parts.length === 0) {
            this.cancel();
            return "cancelled";
        }
        const name = parts[0].toLowerCase();
        const exact = this.commands.find((c) => c.name === name);
        if (exact) {
            this._result = { cmd: exact.name, args: parts.slice(1) };
        }
        else {
            // Not an exact command: run the highlighted match (fuzzy UX).
            const m = this.matches[this.sel];
            if (!m) {
                this._result = { cmd: name, args: parts.slice(1) };
            }
            else {
                this._result = { cmd: m.name, args: [] };
            }
        }
        this.erase();
        this.active = false;
        return "done";
    }
    cancel() {
        this.erase();
        this.active = false;
        this._result = null;
    }
    draw() {
        this.erase();
        const lines = [];
        // Input line with cursor block.
        const before = this.buf.slice(0, this.cursor);
        const at = this.buf[this.cursor] ?? " ";
        const after = this.buf.slice(this.cursor + 1);
        lines.push(`${(0, ui_1.cyan)("❯")} ${before}${(0, ui_1.bold)(at)}${after}`);
        lines.push((0, ui_1.dim)("  esc to cancel · tab to complete · ctrl+p/n to move"));
        this.matches.forEach((m, i) => {
            const mark = i === this.sel ? (0, ui_1.cyan)("●") : (0, ui_1.gray)("○");
            lines.push(`  ${mark} ${(0, ui_1.bold)("/" + m.name)} ${(0, ui_1.dim)(m.description)}`);
        });
        // Pad to a fixed height so redraws don't leave ghosts.
        const height = 2 + PANEL_MATCHES;
        while (lines.length < height)
            lines.push("");
        this.term.write(lines.join("\n") + "\n");
        // Move cursor back up to the start of the panel for the next redraw.
        this.term.write(`\x1b[${height}A`);
        this.drawnLines = height;
    }
    erase() {
        if (this.drawnLines > 0) {
            // We're sitting at the panel start (draw left us there). Clear down.
            this.term.write(`\x1b[${this.drawnLines}B`); // go to panel bottom
            for (let i = 0; i < this.drawnLines; i++) {
                this.term.write("\x1b[2K\x1b[A");
            }
            this.term.write("\x1b[2K");
            this.drawnLines = 0;
        }
    }
}
exports.Palette = Palette;
