/* Shared types for geminiswitcher. */

export interface QuotaInfo {
  /** Human-readable quota summary, e.g. "62% remaining (5h)" */
  text: string;
  /** ISO timestamp of when this was observed */
  at: string;
}

export interface Account {
  /** Stable local id, e.g. "personal-8f3k2" */
  id: string;
  /** Friendly label chosen at /add time */
  name: string;
  /** Best-effort email extracted from the stored credential, else null */
  email: string | null;
  /** Best-effort plan label ("AI Pro", "AI Plus", ...), else null */
  plan: string | null;
  addedAt: string;
  /** ISO timestamp of last activation, else null */
  lastUsed: string | null;
  lastQuota: QuotaInfo | null;
}

export interface Settings {
  /** Master autoswitch toggle */
  autoswitch: boolean;
  /** Path (or name on PATH) of the agy binary */
  agyPath: string;
  /** Ordered list of argv vectors tried to trigger agy's login flow, e.g. [["login"],["auth","login"]] */
  loginCommands: string[][];
  /** Args used when relaunching agy to resume a session */
  resumeArgs: string[];
  /** If a conversation id was captured from output, prefer --conversation <id> over resumeArgs */
  preferConversationId: boolean;
  /** After printing our /usage table, also forward "/usage" to agy so it prints live current-account quota */
  forwardUsageToAgy: boolean;
  /** Write handoff.md on autoswitch (default false — resume-based context is preferred) */
  handoffEnabled: boolean;
  /** Type a short "continue" instruction into agy after resume (default false) */
  injectContinuePrompt: boolean;
  continuePromptText: string;
  /** Minimum ms between automatic limit reactions (prevents switch loops) */
  limitCooldownMs: number;
}

export interface State {
  version: 1;
  activeAccountId: string | null;
  autoswitch: boolean;
  accounts: Account[];
  settings: Settings;
}

/** Result of scanning a chunk of terminal output for limit signals. */
export interface LimitSignal {
  hit: boolean;
  /** 'hard' = RESOURCE_EXHAUSTED/429 style hard limit, 'soft' = approaching-limit hint */
  kind: "hard" | "soft";
  /** Short label of what matched, for display */
  signal: string;
}
