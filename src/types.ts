/* Shared types for geminiswitcher v2. */

export interface QuotaInfo {
  text: string;
  at: string;
}

export interface Account {
  id: string;
  name: string;
  email: string | null;
  plan: string | null;
  addedAt: string;
  lastUsed: string | null;
  lastQuota: QuotaInfo | null;
}

export interface Settings {
  autoswitch: boolean;
  agyPath: string;
  /** The command used to trigger agy's login flow. Correct value: ["auth", "login"]. */
  loginCommand: string[];
  resumeArgs: string[];
  preferConversationId: boolean;
  forwardUsageToAgy: boolean;
  handoffEnabled: boolean;
  injectContinuePrompt: boolean;
  continuePromptText: string;
  /** Min ms between automatic limit reactions. */
  limitCooldownMs: number;
  /** Pause autoswitch after this many switches within switchLoopWindowMs. */
  switchLoopMax: number;
  switchLoopWindowMs: number;
  /** Remember the active account per directory. */
  rememberDirAccount: boolean;
  /** Key that opens the command palette anywhere. */
  paletteKey: string;
}

export interface DirPref {
  accountId: string;
  updatedAt: string;
}

export interface State {
  version: 2;
  activeAccountId: string | null;
  autoswitch: boolean;
  accounts: Account[];
  settings: Settings;
  /** absolute directory path -> preference */
  dirPrefs: Record<string, DirPref>;
}

export type AppPhase =
  | "starting"
  | "ready"
  | "switching"
  | "adding"
  | "ended";

export interface LimitEvent {
  kind: "hard" | "soft";
  signal: string;
  at: number;
}
