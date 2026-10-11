/* Persistent state: accounts + settings + per-directory prefs.
 * Stored at ~/.config/geminiswitcher/state.json (mode 0600).
 */
import * as fs from "fs";
import * as path from "path";
import { State } from "./types";
import { configDir, stateFile, withDefaults } from "./config";

function blank(): State {
  return {
    version: 2,
    activeAccountId: null,
    autoswitch: true,
    accounts: [],
    settings: withDefaults(),
    dirPrefs: {},
  };
}

export function loadState(): State {
  const file = stateFile();
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<State>;
    const base = blank();
    const merged: State = {
      version: 2,
      activeAccountId: parsed.activeAccountId ?? base.activeAccountId,
      autoswitch: parsed.autoswitch ?? base.autoswitch,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      settings: withDefaults(parsed.settings ?? {}),
      dirPrefs:
        parsed.dirPrefs && typeof parsed.dirPrefs === "object" ? parsed.dirPrefs : {},
    };
    // Migrate v1 loginCommands -> v2 loginCommand (correct flow only).
    const v1 = parsed as unknown as { settings?: { loginCommands?: string[][] } };
    if (v1.settings?.loginCommands && !parsed.settings?.loginCommand) {
      merged.settings.loginCommand = ["auth", "login"];
    }
    if (typeof parsed.autoswitch === "boolean") merged.settings.autoswitch = parsed.autoswitch;
    else merged.autoswitch = merged.settings.autoswitch;
    return merged;
  } catch {
    return blank();
  }
}

export function saveState(state: State): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  state.version = 2;
  state.autoswitch = state.settings.autoswitch;
  const tmp = path.join(dir, `.state.json.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, stateFile());
  try {
    fs.chmodSync(stateFile(), 0o600);
  } catch {
    /* best effort */
  }
}
