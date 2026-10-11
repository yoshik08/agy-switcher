/* End-to-end: real binary in a PTY, mock agy, fake keytar.
 * Covers: startup, palette (/accounts), hard-limit autoswitch with token swap
 * and `agy -c` relaunch, autoswitch-off leaves everything alone.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const pty = require("node-pty");

const DIST = path.join(__dirname, "..", "dist", "index.js");

function writeMockAgy(dir) {
  const p = path.join(dir, "mock-agy.sh");
  fs.writeFileSync(
    p,
    [
      "#!/bin/bash",
      'echo "mock-agy args: $*" >> "$MOCK_AGY_LOG"',
      'echo "mock-agy ready ($*)"',
      'while IFS= read -r line; do',
      '  clean=$(echo "$line" | tr -d "\\r")',
      '  if [ "$clean" = "TRIGGER_LIMIT" ]; then',
      '    echo "Error: RESOURCE_EXHAUSTED: quota exceeded for model"',
      "  else",
      '    echo "echo: $clean"',
      "  fi",
      "done",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  return p;
}

function writeFakeKeytar(dir) {
  const modDir = path.join(dir, "fake-nm", "keytar");
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(path.join(modDir, "package.json"), JSON.stringify({ name: "keytar", main: "index.js" }));
  fs.writeFileSync(
    path.join(modDir, "index.js"),
    [
      "const fs = require('fs');",
      "let kv = {};",
      "try { kv = JSON.parse(process.env.KEYTAR_SEED || '{}'); } catch {}",
      "const log = process.env.MOCK_KEYRING_LOG;",
      "function note(op, s, a) { if (log) fs.appendFileSync(log, op + ' ' + s + ':' + a + '\\n'); }",
      "module.exports = {",
      "  getPassword: async (s, a) => (s + ':' + a) in kv ? kv[s + ':' + a] : null,",
      "  setPassword: async (s, a, p) => { kv[s + ':' + a] = p; note('set', s, a); },",
      "  deletePassword: async (s, a) => { delete kv[s + ':' + a]; note('del', s, a); },",
      "};",
      "",
    ].join("\n")
  );
  return path.join(dir, "fake-nm");
}

function seedState(dir) {
  const cfg = path.join(dir, "cfg");
  fs.mkdirSync(cfg, { recursive: true });
  const now = new Date().toISOString();
  const state = {
    version: 2,
    activeAccountId: "id-personal",
    autoswitch: true,
    accounts: [
      { id: "id-personal", name: "personal", email: "p@gmail.com", plan: "AI Pro", addedAt: now, lastUsed: now, lastQuota: null },
      { id: "id-work", name: "work", email: "w@gmail.com", plan: "AI Pro", addedAt: now, lastUsed: null, lastQuota: null },
    ],
    settings: {
      autoswitch: true,
      agyPath: "agy",
      loginCommand: ["auth", "login"],
      resumeArgs: ["-c"],
      preferConversationId: true,
      forwardUsageToAgy: false,
      handoffEnabled: false,
      injectContinuePrompt: false,
      continuePromptText: "",
      limitCooldownMs: 2000,
      switchLoopMax: 5,
      switchLoopWindowMs: 60000,
      rememberDirAccount: true,
      paletteKey: "ctrl+g",
    },
    dirPrefs: {},
  };
  fs.writeFileSync(path.join(cfg, "state.json"), JSON.stringify(state), { mode: 0o600 });
  return cfg;
}

function waitFor(getOutput, re, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (re.test(getOutput())) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error(`timeout waiting for ${label}; output tail:\n${getOutput().slice(-800)}`));
      }
    }, 100);
  });
}

async function runScenario({ autoswitch }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsw-e2e-"));
  const mockAgy = writeMockAgy(dir);
  const fakeNm = writeFakeKeytar(dir);
  const cfg = seedState(dir);
  const agyLog = path.join(dir, "agy.log");
  const keyringLog = path.join(dir, "keyring.log");
  fs.writeFileSync(agyLog, "");
  fs.writeFileSync(keyringLog, "");

  if (autoswitch === false) {
    const st = JSON.parse(fs.readFileSync(path.join(cfg, "state.json"), "utf8"));
    st.settings.autoswitch = false;
    st.autoswitch = false;
    fs.writeFileSync(path.join(cfg, "state.json"), JSON.stringify(st));
  }

  // Hide the real keytar so the child resolves our fake via NODE_PATH.
  // (stashed inside the project dir — same filesystem, rename works)
  const realKeytar = path.join(__dirname, "..", "node_modules", "keytar");
  const stashed = path.join(__dirname, "..", ".keytar-stashed-for-test");
  const hadReal = fs.existsSync(realKeytar);
  if (hadReal) fs.renameSync(realKeytar, stashed);

  let output = "";
  const child = pty.spawn("node", [DIST, "--agy-path", mockAgy], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: dir,
    env: {
      ...process.env,
      GEMINISWITCHER_DIR: cfg,
      NODE_PATH: fakeNm,
      MOCK_AGY_LOG: agyLog,
      MOCK_KEYRING_LOG: keyringLog,
      KEYTAR_SEED: JSON.stringify({
        "geminiswitcher:account:id-personal": "TOKEN_A",
        "geminiswitcher:account:id-work": "TOKEN_B",
        "gemini:antigravity": "TOKEN_A",
      }),
    },
  });
  child.onData((d) => (output += d));
  // eslint-disable-next-line no-control-regex
  const strip = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b[()][0-9A-B]/g, "");
  const getOutput = () => strip(output);

  const done = (async () => {
    try {
      await waitFor(getOutput, /mock-agy ready/, 15000, "agy startup");

      // Palette: "/" opens, "accounts" + enter lists accounts.
      child.write("/");
      await waitFor(getOutput, /❯ \//, 8000, "palette open");
      child.write("accounts\r");
      await waitFor(getOutput, /personal/, 8000, "accounts table");

      // Trigger a hard limit.
      const before = fs.readFileSync(agyLog, "utf8");
      child.write("TRIGGER_LIMIT\r");
      await waitFor(getOutput, /RESOURCE_EXHAUSTED/, 8000, "limit echo");

      if (autoswitch === false) {
        await new Promise((r) => setTimeout(r, 2500));
        assert.match(getOutput(), /autoswitch is.*off/i);
        const after = fs.readFileSync(agyLog, "utf8");
        assert.equal(after, before, "agy must not relaunch when autoswitch is off");
        assert.ok(!fs.readFileSync(keyringLog, "utf8").includes("set gemini:antigravity"), "keyring untouched");
        return { output: getOutput(), agyLog: after };
      }

      await waitFor(getOutput, /limit detected/i, 15000, "switch panel");
      await waitFor(getOutput, /resumed on/, 15000, "switch completion");
      await waitFor(getOutput, /mock-agy ready \(-c\)/, 15000, "agy relaunch with -c");

      const keyringOps = fs.readFileSync(keyringLog, "utf8");
      assert.ok(keyringOps.includes("set gemini:antigravity"), "active slot rewritten:\n" + keyringOps);
      const state = JSON.parse(fs.readFileSync(path.join(cfg, "state.json"), "utf8"));
      assert.equal(state.activeAccountId, "id-work");
      return { output: getOutput(), agyLog: fs.readFileSync(agyLog, "utf8") };
    } finally {
      try {
        child.kill();
      } catch {}
      if (hadReal) fs.renameSync(stashed, realKeytar);
    }
  })();

  const result = await done;
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

test("e2e: hard limit triggers autoswitch, token swap, agy -c relaunch", async () => {
  const { output } = await runScenario({ autoswitch: true });
  assert.match(output, /Now on/);
}, { timeout: 90000 });

test("e2e: autoswitch off leaves account and process alone", async () => {
  await runScenario({ autoswitch: false });
}, { timeout: 90000 });
