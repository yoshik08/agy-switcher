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
exports.PtyHost = void 0;
/* Owns the agy child process: spawn, write, resize, graceful terminate.
 * Emits output/exit events to the application; it never interprets content.
 */
const pty = __importStar(require("node-pty"));
class PtyHost {
    bin;
    baseArgs;
    cwd;
    events;
    child = null;
    expectExit = false;
    constructor(bin, baseArgs, cwd, events) {
        this.bin = bin;
        this.baseArgs = baseArgs;
        this.cwd = cwd;
        this.events = events;
    }
    get alive() {
        return this.child !== null;
    }
    spawn(extraArgs, cols, rows) {
        if (this.child)
            throw new Error("pty already running");
        this.expectExit = false;
        this.child = pty.spawn(this.bin, [...this.baseArgs, ...extraArgs], {
            name: "xterm-256color",
            cols,
            rows,
            cwd: this.cwd,
            env: process.env,
        });
        this.child.onData((d) => this.events.onData(d));
        this.child.onExit(({ exitCode }) => {
            this.child = null;
            this.events.onExit(exitCode);
        });
    }
    write(data) {
        if (this.child)
            this.child.write(data);
    }
    resize(cols, rows) {
        if (this.child) {
            try {
                this.child.resize(cols, rows);
            }
            catch {
                /* ignore */
            }
        }
    }
    /** SIGTERM, wait, then SIGKILL. Marks the exit as expected. */
    async terminate() {
        const child = this.child;
        this.child = null;
        if (!child)
            return;
        this.expectExit = true;
        await new Promise((resolve) => {
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
                setTimeout(finish, 300);
            }, 2500);
        });
    }
    /** Was the most recent exit one we initiated? */
    get expectedExit() {
        return this.expectExit;
    }
    killNow() {
        if (this.child) {
            try {
                this.child.kill("SIGKILL");
            }
            catch {
                /* ignore */
            }
            this.child = null;
        }
    }
}
exports.PtyHost = PtyHost;
