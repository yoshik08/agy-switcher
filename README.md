# geminiswitcher

A Claude Code–style terminal wrapper for the **Google Antigravity CLI (`agy`)** that lets you work across multiple Google AI Pro / Plus accounts without manually switching when one hits its limits.

Run it inside any project directory — just like `claude` or `agy` — and it launches and manages `agy` under the hood. You get a small set of discoverable slash commands; everything else passes straight through to `agy`.

```
$ geminiswitcher

  ◆ geminiswitcher  v1.0.0
  multi-account wrapper for the Antigravity CLI (agy)

[geminiswitcher] Account: personal <you@gmail.com> · AI Pro   Autoswitch: ON
[geminiswitcher] Type /help inside the session for commands. Launching agy…
```

---

## Installation

Requires **Node.js 18+**.

```bash
npm install -g geminiswitcher
```

Then, in any project directory:

```bash
geminiswitcher
```

On first run there are no accounts yet, so you'll be walked through adding your first Google account (see `/add` below), then dropped straight into `agy`.

### CLI flags

| Flag | Behavior |
|---|---|
| `--help, -h` | Show help |
| `--version, -v` | Show version |
| `--add` | Add an account (drives `agy`'s login) and exit — no session started |
| `--agy-path <bin>` | Use a different `agy` binary |
| `-- <args…>` / any other args | Forwarded to `agy` on every launch (e.g. `geminiswitcher -- --model foo`) |

---

## First-run flow

1. `geminiswitcher` notices there are no accounts.
2. It runs `agy login` (configurable, see below) with your real terminal — complete the Google login in the browser as normal.
3. geminiswitcher reads the credential `agy` just stored in your OS keyring, copies it into its own vault slot, and asks you to name the account (`personal`, `work`, …).
4. The account becomes active and `agy` launches.

Repeat with `/add` (or `geminiswitcher --add`) for each Google account you want in the rotation.

---

## Slash commands

These are intercepted by geminiswitcher — `agy` never sees them. Anything that isn't one of these is forwarded to `agy` untouched.

| Command | Behavior |
|---|---|
| `/add` | Opens `agy`'s Google login in your terminal, captures the new credential from the OS keyring, and stores it securely. Briefly restarts `agy` (with resume) if a session is running — asks for confirmation first. |
| `/accounts` or `/list` | Shows all accounts: name, email, plan, cached quota, last used, and which is active. |
| `/usage` | Shows remaining usage for **all** accounts (best-effort cache learned from `agy`'s own output), then forwards `/usage` to `agy` so you also get the live current-account figure. |
| `/switch <name>` | Manually switch to another account. Quits `agy`, swaps the token, relaunches with resume. Fuzzy-matches on name/email/id. |
| `/autoswitch-on` | Enable automatic switching when a limit is hit. |
| `/autoswitch-off` | Disable automatic switching completely. |
| `/handoff` | Write a minimal `handoff.md` snapshot in the current directory, on demand. |
| `/help` | Lists all commands and explains autoswitch + context behavior. |

---

## Autoswitch: ON vs OFF (read this)

This is the core behavior contract of the tool.

### When `/autoswitch-on` is active (default)

1. geminiswitcher watches `agy`'s output for hard limit signals: `RESOURCE_EXHAUSTED`, HTTP `429` with error context, `quota exceeded`, `rate limit`.
2. On detection it **quits the running `agy` process** (a running process holds its keyring token in memory — true mid-process credential swapping is unreliable).
3. It picks the next account (least-recently-used rotation), writes that account's token into the system keyring at `service=gemini, account=antigravity` — the single slot `agy` reads.
4. It relaunches `agy -c` (or `agy --conversation <id>` if a conversation id was captured) **in the same directory**, so your work resumes with minimal disruption.
5. No full `handoff.md` is written — the dying account is never asked to burn tokens summarizing itself. A minimal `handoff.md` is written only if you explicitly enable it (`handoffEnabled` in config, or `/handoff` on demand).

If no other accounts are configured, it tells you to `/add` one and stays put.

### When `/autoswitch-off` is active

- **No automatic account switching.** Ever.
- **No `handoff.md` is generated.** Not on limits, not on exit, not ever — the generator is only reachable through the autoswitch path (when explicitly enabled) or the manual `/handoff` command.
- You stay on the current account until you `/switch` manually or turn autoswitch back on.
- When a limit is detected you'll see a one-line notice suggesting `/switch <name>` — that's it.

---

## How context is preserved (resume-based)

True mid-process credential swapping doesn't work with `agy`: the running process holds the keyring token in memory, and the OS keyring slot is single-slot per machine. So context preservation is **resume-based, not handoff-based**:

- **Detect** the limit (hard `RESOURCE_EXHAUSTED` / `429` in output or logs; soft "approaching limit" hints only produce a notice).
- **Don't** make the dying account write a full handoff — that wastes its remaining tokens.
- **Quit** the current `agy` process.
- **Swap** the next account's token into the keyring (`service=gemini, account=antigravity`).
- **Relaunch** `agy` in the same directory with `agy -c` (or `--conversation <id>` when one was captured from output).
- **Optionally** type a short "continue" instruction after resume (off by default; `injectContinuePrompt` in config).

Minimal or zero agent-written handoff is the default. A structured `handoff.md` exists only as an opt-in (`/handoff`, or `handoffEnabled: true` in config).

---

## How auth storage works

- **Per-account tokens** live in your OS keyring under service `geminiswitcher`, one entry per account (`account:<id>`) — via macOS Keychain, Linux Secret Service, or Windows Credential Manager.
- **The active slot** `service=gemini, account=antigravity` is the single slot `agy` itself reads. geminiswitcher copies the active account's token there on launch and on every switch.
- **Account metadata** (names, emails, plan labels, quota cache) lives in `~/.config/geminiswitcher/state.json` (mode `0600`). No tokens there — ever.
- `/add` doesn't implement OAuth itself: it shells out to `agy`'s own login flow and captures whatever credential `agy` stored. No client secrets to configure.
- Tokens are treated as opaque strings and copied verbatim. Token refresh is `agy`'s job — it refreshes using its own client credentials whenever it runs.
- **No telemetry.** Nothing leaves your machine.

---

## Configuration

`~/.config/geminiswitcher/state.json` (also honored: `GEMINISWITCHER_DIR` to relocate, `GEMINISWITCHER_AGY` to override the binary):

```jsonc
{
  "settings": {
    "autoswitch": true,            // master toggle (also /autoswitch-on|off)
    "agyPath": "agy",             // binary to launch
    "loginCommands": [["login"], ["auth", "login"]],  // tried in order for /add
    "resumeArgs": ["-c"],         // args used when relaunching to resume
    "preferConversationId": true, // use --conversation <id> when one was captured
    "forwardUsageToAgy": true,    // /usage also asks agy for the live figure
    "handoffEnabled": false,      // write handoff.md automatically on autoswitch
    "injectContinuePrompt": false,// type a "continue" note into agy after resume
    "continuePromptText": "Continuing previous session after an automatic account switch. Please carry on.",
    "limitCooldownMs": 60000      // min ms between automatic limit reactions
  }
}
```

Unknown settings are ignored; missing ones fall back to defaults.

---

## Limitations (honest list)

- **The keyring slot `agy` reads is machine-wide.** Switching accounts here switches it for every `agy` process on this machine.
- **A running `agy` must be quit before its credentials can be swapped.** That's why every switch is quit → swap → relaunch.
- **Quota figures are best-effort.** `/accounts` and `/usage` show what geminiswitcher has observed in `agy`'s own output (percent-remaining lines, plan labels), plus a live `/usage` forwarded to `agy` for the current account. There is no private quota API.
- **Limit detection is heuristic** — output scanning for `RESOURCE_EXHAUSTED` / `429` / quota language. A bare `429` in code you're writing won't trigger it (error context is required).
- **Conversation-id capture is heuristic** — strict patterns like `conversation id: <id>`; resume falls back to `agy -c`.
- **The `/add` login flow depends on `agy`'s CLI surface** (`agy login`, falling back to `agy auth login`). If your `agy` build uses a different command, set `loginCommands` in the config.
- **Slash interception is keystroke-level.** If you use exotic line editing (or paste a multi-line block starting with `/`), the wrapper may fail safe and forward the line to `agy` instead of intercepting it.
- **No Windows/macOS CI here** — keyring and PTY paths are implemented against the standard OS APIs (`keytar`, `node-pty`) but primarily exercised on Linux in this repo's tests.

---

## Design philosophy

This tool is intentionally simple and discoverable:

- A handful of slash commands, all listed in `/help` — no hidden modes.
- Resume-based context (`agy -c`), not elaborate handoff documents.
- The OFF state is a hard guarantee: no automatic switching, no `handoff.md`, no surprises.
- Errors are plain sentences telling you what happened and what to do next (failed keyring write, no accounts configured, login produced no credential, …).

---

## Development

```bash
git clone https://github.com/yoshik08/agy-switcher.git
cd agy-switcher
npm install
npm run build     # tsc → dist/
npm test          # unit + e2e (mock agy) via node --test
```

`npm test` runs three suites: pure-logic unit tests (`detect`, `accounts`, `store`), slash-command handler tests, and end-to-end tests that drive a mock `agy` binary through the real PTY session — including a hard-limit autoswitch (token swap + `agy -c` relaunch) and the autoswitch-OFF no-op path. The OS keyring is mocked in tests; on a real machine `keytar` talks to the native keyring.

---

## License

MIT
