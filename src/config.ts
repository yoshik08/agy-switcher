/* Constants, paths and default settings (v2). */
import * as os from "os";
import * as path from "path";
import { Settings } from "./types";

export const APP_NAME = "geminiswitcher";
export const VERSION = "2.0.0";

/** OS keyring slot that agy itself reads. Single-slot per machine. */
export const ACTIVE_SERVICE = "gemini";
export const ACTIVE_ACCOUNT = "antigravity";

/** Our own vault namespace inside the OS keyring (one entry per account). */
export const VAULT_SERVICE = "geminiswitcher";
export const vaultKey = (accountId: string) => `account:${accountId}`;

export function configDir(): string {
  const override = process.env.GEMINISWITCHER_DIR;
  if (override && override.trim()) return override;
  return path.join(os.homedir(), ".config", APP_NAME);
}

export function stateFile(): string {
  return path.join(configDir(), "state.json");
}

export function defaultSettings(): Settings {
  return {
    autoswitch: true,
    agyPath: process.env.GEMINISWITCHER_AGY || "agy",
    // Correct login flow. Never "login" alone.
    loginCommand: ["auth", "login"],
    resumeArgs: ["-c"],
    preferConversationId: true,
    forwardUsageToAgy: true,
    handoffEnabled: false,
    injectContinuePrompt: false,
    continuePromptText:
      "Continuing previous session after an automatic account switch. Please carry on.",
    limitCooldownMs: 60_000,
    switchLoopMax: 2,
    switchLoopWindowMs: 10 * 60_000,
    rememberDirAccount: true,
    paletteKey: "ctrl+g",
  };
}

export function withDefaults(partial: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...partial };
}
