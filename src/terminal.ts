/* Terminal ownership: raw mode, pinned status bar via scroll region, resize.
 *
 * The status bar lives on the last terminal line, pinned by restricting the
 * scroll region (DECSTBM) to rows 1..N-1. agy's output scrolls inside the
 * region; the bar stays put. If a terminal ignores DECSTBM the bar simply
 * scrolls like normal output — graceful degradation.
 */
export class Terminal {
  private raw = false;
  private statusReserved = false;
  private resizeHandlers: Array<() => void> = [];
  private sigtermHandlers: Array<() => void> = [];
  private lastStatus = "";

  get rows(): number {
    return process.stdout.rows || 30;
  }

  get cols(): number {
    return process.stdout.columns || 80;
  }

  /** Rows available to the PTY child (everything above the status bar). */
  get ptyRows(): number {
    return Math.max(10, this.rows - 1);
  }

  get isTTY(): boolean {
    return !!process.stdout.isTTY && !!process.stdin.isTTY;
  }

  write(s: string): void {
    process.stdout.write(s);
  }

  writeln(s = ""): void {
    process.stdout.write(s + "\n");
  }

  enterRaw(): void {
    if (process.stdin.isTTY && !this.raw) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      this.raw = true;
    }
  }

  exitRaw(): void {
    if (this.raw) {
      try {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
      this.raw = false;
    }
  }

  get isRaw(): boolean {
    return this.raw;
  }

  /** Pin the status bar to the bottom line. */
  reserveStatus(): void {
    if (this.statusReserved || !process.stdout.isTTY) return;
    const n = this.rows;
    // Restrict scroll region to 1..N-1, then draw the bar on line N.
    this.write(`\x1b[1;${n - 1}r`);
    this.statusReserved = true;
    this.renderStatus(this.lastStatus);
  }

  releaseStatus(): void {
    if (!this.statusReserved) return;
    this.write("\x1b[r"); // reset scroll region to full screen
    this.statusReserved = false;
  }

  renderStatus(text: string): void {
    this.lastStatus = text;
    if (!this.statusReserved || !process.stdout.isTTY) return;
    const n = this.rows;
    // Save cursor, jump to last line, clear it, draw, restore.
    this.write(`\x1b7\x1b[${n};1H\x1b[2K${text}\x1b8`);
  }

  clearStatus(): void {
    this.renderStatus("");
  }

  onResize(fn: () => void): void {
    this.resizeHandlers.push(fn);
    if (this.resizeHandlers.length === 1) {
      process.stdout.on("resize", () => {
        // Re-pin the bar after a resize.
        if (this.statusReserved) {
          this.write("\x1b[r");
          this.statusReserved = false;
          this.reserveStatus();
        }
        for (const h of this.resizeHandlers) h();
      });
    }
  }

  onSigterm(fn: () => void): void {
    this.sigtermHandlers.push(fn);
    if (this.sigtermHandlers.length === 1) {
      process.on("SIGTERM", () => {
        for (const h of this.sigtermHandlers) h();
      });
    }
  }

  /** Restore the terminal to a sane state (call on exit). */
  restore(): void {
    this.releaseStatus();
    this.exitRaw();
    this.write("\n");
  }
}
