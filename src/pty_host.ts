/* Owns the agy child process: spawn, write, resize, graceful terminate.
 * Emits output/exit events to the application; it never interprets content.
 */
import * as pty from "node-pty";

export interface PtyEvents {
  onData(data: string): void;
  onExit(code: number): void;
}

export class PtyHost {
  private child: pty.IPty | null = null;
  private expectExit = false;

  constructor(
    private readonly bin: string,
    private readonly baseArgs: string[],
    private readonly cwd: string,
    private readonly events: PtyEvents
  ) {}

  get alive(): boolean {
    return this.child !== null;
  }

  spawn(extraArgs: string[], cols: number, rows: number): void {
    if (this.child) throw new Error("pty already running");
    this.expectExit = false;
    this.child = pty.spawn(this.bin, [...this.baseArgs, ...extraArgs], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: this.cwd,
      env: process.env as Record<string, string>,
    });
    this.child.onData((d: string) => this.events.onData(d));
    this.child.onExit(({ exitCode }) => {
      this.child = null;
      this.events.onExit(exitCode);
    });
  }

  write(data: string): void {
    if (this.child) this.child.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.child) {
      try {
        this.child.resize(cols, rows);
      } catch {
        /* ignore */
      }
    }
  }

  /** SIGTERM, wait, then SIGKILL. Marks the exit as expected. */
  async terminate(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child) return;
    this.expectExit = true;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          clearInterval(probe);
          clearTimeout(force);
          resolve();
        }
      };
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
        setTimeout(finish, 300);
      }, 2500);
    });
  }

  /** Was the most recent exit one we initiated? */
  get expectedExit(): boolean {
    return this.expectExit;
  }

  killNow(): void {
    if (this.child) {
      try {
        this.child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      this.child = null;
    }
  }
}
