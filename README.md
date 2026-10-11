# geminiswitcher

A Claude Code–style home for the **Google Antigravity CLI (`agy`)** — work across multiple Google AI Pro / Plus accounts without manually switching when one hits its limits.

Run it inside any project directory, just like `claude` or `agy`:

```
$ geminiswitcher

  ◆ geminiswitcher  v2.0.0
  claude-code-style home for the antigravity cli

  directory    ~/projects/foo
  account      personal <you@gmail.com> · AI Pro
  autoswitch   on

  press / or ctrl+g for commands · launching agy…
```

Once running, a status bar stays pinned to the bottom of your terminal (`● personal · Pro · autoswitch on`). Press `/` (or `ctrl+g` anywhere) for the command palette — fuzzy search, tab completion, `esc` to cancel. Everything else goes straight to `agy`.

---

## Installation

Requires **Node.js 18+** and the `agy` CLI on your PATH.

```bash
npm install -g geminiswitcher
```

On Linux you also need a Secret Service keyring provider (e.g. `gnome-keyring`); macOS Keychain and Windows Credential Manager work out of the box.

## First run

```bash
cd ~/projects/foo
geminiswitcher
```

If no accounts exist, you're guided through adding one: geminiswitcher runs **`agy auth login`** (the correct login flow) and stores the resulting credential in your OS keyring. Name it (`personal`, `work`, …) and you're in. The active account for each directory is remembered.

You can also add accounts without starting a session:

```bash
geminiswitcher --add
```

---

## Commands

All commands run in geminiswitcher — `agy` never sees them.

| Command | What it does |
|---|---|
| `/add` | Add a Google account via `agy auth login` (token → OS keyring vault) |
| `/accounts` (alias `/list`) | All accounts: plan, observed quota, last used, active marker |
| `/usage` | Quota table for all accounts, then live current-account usage from agy |
| `/switch <name>` | Switch now — tab-completes account names, resumes with `agy -c` |
| `/autoswitch-on` | Auto-switch when a hard limit is hit |
| `/autoswitch-off` | Never switch automatically (and no `handoff.md`, ever) |
| `/handoff` | Write a `handoff.md` snapshot on demand (opt-in, off by default) |
| `/help` | Full help |

## Autoswitch

**On** (default): when agy reports a hard limit (`RESOURCE_EXHAUSTED`, HTTP 429 with error context, quota/rate-limit exceeded), geminiswitcher takes over the screen with a clear progress panel, picks the least-recently-used account, swaps its token into the keyring slot agy reads (`service=gemini`, `account=antigravity`), and relaunches **`agy -c`** (or `--conversation <id>` when a conversation id was observed) in the same directory. Then it hands the terminal back.

**Off**: nothing automatic happens. No switches, and **`handoff.md` is never written**. You stay put until you `/switch` manually.

Two safety rails:

- **Cooldown** — one automatic reaction per minute max.
- **Loop guard** — after 2 automatic switches within 10 minutes, autoswitch pauses itself and tells you (a limit storm would otherwise burn every account). `/autoswitch-on` resumes it.

Quota figures in `/accounts` and the status bar are best-effort observations from agy's own output, not a billing API.

## Context & resume

Resume-based, like Claude Code. A running `agy` holds its token in memory, so every switch quits `agy` and relaunches with `agy -c`. The dying account is never asked to write a summary. `handoff.md` is strictly opt-in (`/handoff`, or enable it in config) — it never appears on its own, and never when autoswitch is off.

---

## How it works

```
┌─────────────────────────────────────────────┐
│ geminiswitcher (owns the terminal)          │
│  · status bar pinned to the bottom line     │
│  · / command palette (fuzzy + tab)          │
│  · input router: agy / palette / blocking   │
│  · limit detector + switch loop guard       │
├─────────────────────────────────────────────┤
│ agy (child PTY, relaunched on switch)       │
├─────────────────────────────────────────────┤
│ OS keyring                                  │
│  · gemini/antigravity        ← agy reads    │
│  · geminiswitcher/account:*  ← vault        │
└─────────────────────────────────────────────┘
```

- Tokens live in the OS keyring. The vault (`geminiswitcher`) holds one entry per account; the single active slot (`gemini`/`antigravity`) is what agy reads. geminiswitcher copies vault → slot on every activation and repairs drift on startup.
- State (accounts, settings, per-directory account memory) lives in `~/.config/geminiswitcher/state.json` (mode `0600`).
- Limit detection is heuristic: strong patterns for hard limits, debounced, and matches are ignored when they merely echo what you just typed (pasted code containing "429" won't trigger a switch).
- No telemetry. No network calls except npm's own. Everything is local.

## Configuration

`geminiswitcher --help` shows CLI flags. Settings live in `state.json` under `settings`:

| Key | Default | Notes |
|---|---|---|
| `autoswitch` | `true` | master switch |
| `agyPath` | `"agy"` | also `--agy-path` |
| `loginCommand` | `["auth","login"]` | correct agy login flow — never `agy login` |
| `resumeArgs` | `["-c"]` | used on every relaunch |
| `preferConversationId` | `true` | use `--conversation <id>` when one was observed |
| `forwardUsageToAgy` | `true` | `/usage` also asks agy live |
| `handoffEnabled` | `false` | opt-in `handoff.md` on switches |
| `limitCooldownMs` | `60000` | min gap between automatic reactions |
| `switchLoopMax` / `switchLoopWindowMs` | `2` / `600000` | loop guard |
| `rememberDirAccount` | `true` | per-directory active account |
| `paletteKey` | `"ctrl+g"` | informational |

---

## Limitations (read these)

1. **A switch is a relaunch.** `agy` holds its token in memory, so there is no true mid-process credential swap. geminiswitcher quits `agy`, swaps the keyring token, and relaunches with `agy -c`. In-flight generations are interrupted; scrollback above the panel is preserved.
2. **One machine-wide keyring slot.** The `gemini`/`antigravity` slot agy reads is shared by every terminal on the machine. Don't run two geminiswitcher sessions on different accounts simultaneously — the second activation wins.
3. **Heuristic limit detection.** It keys off agy's error text (`RESOURCE_EXHAUSTED`, 429-with-context, quota language). If agy rewords its errors, detection may miss; if your own pasted code contains those strings, the echo-guard usually filters it. When in doubt, `/switch` manually.
4. **Quota is observed, not authoritative.** Figures come from agy's output text, not a Google API. Treat them as hints.
5. **Login needs a browser.** `/add` shells out to `agy auth login` in your real terminal — it can't complete headless.
6. **Alternate-screen TUIs.** The pinned status bar assumes agy scrolls the main screen (like Claude Code). If agy ever switches to the alternate screen, the bar degrades to normal scrolling output.
7. **`Ctrl+G` is the escape hatch.** `/` opens the palette only when the input line looks empty; if geminiswitcher ever misjudges, `ctrl+g` works anywhere and `esc` always backs out.

## Development

```bash
git clone https://github.com/yoshik08/agy-switcher
cd agy-switcher
npm install
npm test        # 35 tests: unit + palette + PTY end-to-end (keyring mocked)
npm run build
```

Tests mock `keytar` (no libsecret needed) and drive the real compiled binary inside a PTY with a mock `agy`.

## License

MIT
