/* Persistent state: accounts + settings in ~/.config/geminiswitcher/state.json */
import * as fs from "fs";
import * as path from "path";
import { State } from "./types";
import { configDir, stateFile, withDefaults } from "./config";

function blank(): State {
  return {
    version: 1,
    activeAccountId: null,
    autoswitch: true,
    accounts: [],
    settings: withDefaults(),
  };
}

export function loadState(): State {
  const file = stateFile();
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<State>;
    const base = blank();
    const merged: State = {
      version: 1,
      activeAccountId: parsed.activeAccountId ?? base.activeAccountId,
      autoswitch: parsed.autoswitch ?? base.autoswitch,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      settings: withDefaults(parsed.settings ?? {}),
    };
    // keep top-level autoswitch flag as the source of truth, mirrored from settings for clarity
    if (typeof parsed.autoswitch === "boolean") merged.settings.autoswitch = parsed.autoswitch;
    else merged.autoswitch = merged.settings.autoswitch;
    return merged;
  } catch {
    return blank();
  }
}

/** Atomic-ish write: write temp file then rename. */
export function saveState(state: State): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  // mirror the toggle in both places
  state.autoswitch = state.settings.autoswitch;
  const tmp = path.join(dir, `.state.json.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, stateFile());
  try {
    fs.chmodSync(stateFile(), 0o600);
  } catch {
    /* best effort on odd platforms */
  }
}
