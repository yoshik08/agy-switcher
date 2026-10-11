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
import { StringDecoder } from "string_decoder";

export type InputMode = "agy" | "palette" | "blocking";

export interface RouterEvents {
  /** A keystroke for agy (already filtered). */
  onAgyKey(ch: string): void;
  /** User asked for the command palette. */
  onPaletteOpen(prefill: string): void;
  /** Keystroke while the palette is open. */
  onPaletteKey(ch: string): void;
  /** Keystroke while a blocking flow runs. Return true if handled. */
  onBlockingKey(ch: string): boolean;
}

const PALETTE_KEYS = new Set(["\x07"]); // Ctrl+G

export class InputRouter {
  private mode: InputMode = "agy";
  private decoder = new StringDecoder("utf8");
  private line = "";
  private lineTrusted = true;
  private esc = "";

  constructor(private readonly events: RouterEvents) {}

  get current(): InputMode {
    return this.mode;
  }

  setMode(m: InputMode): void {
    this.mode = m;
    if (m === "agy") {
      this.line = "";
      this.lineTrusted = true;
      this.esc = "";
    }
  }

  attach(): void {
    process.stdin.on("data", this.onData);
  }

  detach(): void {
    process.stdin.off("data", this.onData);
  }

  private onData = (data: Buffer): void => {
    const text = this.decoder.write(data);
    for (const ch of text) this.handleKey(ch);
  };

  /** Route a single keystroke. Public for testing. */
  handleKey(ch: string): void {
    this.route(ch);
  }

  private route(ch: string): void {
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

  private routeAgy(ch: string): void {
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
        if (this.lineTrusted && this.line.length > 0) this.line = this.line.slice(0, -1);
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
      if (this.lineTrusted) this.line += ch;
    } else if (ch !== "\x04" && ch !== "\x0c") {
      this.lineTrusted = false;
    }
    this.events.onAgyKey(ch);
  }

  /** The app calls this when it submits a line to agy by other means. */
  noteExternalSubmit(): void {
    this.line = "";
    this.lineTrusted = true;
  }
}
