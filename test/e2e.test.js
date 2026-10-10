/* E2E test: autoswitch flow against a mock agy binary.
 * Mocks the OS keyring (libsecret isn't available in CI/sandbox).
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ---- mock keytar before dist/keyring is ever required ----
const kv = new Map();
const mockKeytar = {
  getPassword: async (svc, acct) => (kv.has(`${svc}:${acct}`) ? kv.get(`${svc}:${acct}`) : null),
  setPassword: async (svc, acct, pw) => {
    kv.set(`${svc}:${acct}`, pw);
  },
  deletePassword: async (svc, acct) => {
    kv.delete(`${svc}:${acct}`);
  },
};
const keytarPath = require.resolve("keytar");
require.cache[keytarPath] = {
  id: keytarPath,
  filename: keytarPath,
  loaded: true,
  exports: mockKeytar,
};

const { loadState, saveState } = require("../dist/store.js");
const { Session } = require("../dist/session.js");
const { handleLimit } = require("../dist/orchestrate.js");
const { setVaultToken, getActiveToken } = require("../dist/keyring.js");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(cond, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await sleep(100);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

test("e2e: hard limit triggers autoswitch + resume with -c", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsw-e2e-"));
  process.env.GEMINISWITCHER_DIR = dir;
  const mockAgy = path.join(__dirname, "mock-agy.sh");
  fs.chmodSync(mockAgy, 0o755);

  const events = [];
  try {
    const state = loadState();
    state.settings.agyPath = mockAgy;
    state.settings.autoswitch = true;
    state.settings.limitCooldownMs = 1000;
    state.settings.injectContinuePrompt = false;

    // two accounts with distinct tokens
    for (const [name, token] of [["personal", "TOKEN_A"], ["work", "TOKEN_B"]]) {
      const acct = {
        id: `id-${name}`,
        name,
        email: `${name}@gmail.com`,
        plan: "AI Pro",
        addedAt: new Date().toISOString(),
        lastUsed: null,
        lastQuota: null,
      };
      state.accounts.push(acct);
      await setVaultToken(acct.id, token);
    }
    state.activeAccountId = "id-personal";
    state.accounts[0].lastUsed = new Date().toISOString();
    saveState(state);
    await require("../dist/keyring.js").setActiveToken("TOKEN_A");

    assert.equal(await getActiveToken(), "TOKEN_A");

    const session = new Session(state, mockAgy, [], dir, {
      onSlash: async () => {},
      onLimit: async (signal) => {
        events.push(`limit:${signal.signal}`);
        await handleLimit(session, state, signal);
        events.push("handled");
      },
      onEnd: async () => {
        events.push("end");
      },
    });

    session.launch([]);
    // wait for mock to be ready
    await sleep(1200);

    // sanity: still on A
    assert.equal(await getActiveToken(), "TOKEN_A");

    // simulate the user typing trigger429 + Enter (goes straight to pty)
    session.sendToAgy("trigger429\r");

    // autoswitch should fire: token swapped to B, agy relaunched with -c
    await waitFor(async () => (await getActiveToken()) === "TOKEN_B", 15000, "token swap to B");
    events.push("swapped");

    await waitFor(() => events.includes("handled"), 15000, "limit handled");
    assert.equal(state.activeAccountId, "id-work");

    // session should still be alive (relaunched, not ended)
    assert.ok(session.activeChild, "agy should have been relaunched");
    assert.ok(!events.includes("end"), "session should not have ended");

    await session.end();
  } finally {
    delete process.env.GEMINISWITCHER_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("e2e: autoswitch OFF does not switch on hard limit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsw-e2e2-"));
  process.env.GEMINISWITCHER_DIR = dir;
  const mockAgy = path.join(__dirname, "mock-agy.sh");

  const events = [];
  try {
    const state = loadState();
    state.settings.agyPath = mockAgy;
    state.settings.autoswitch = false;
    state.settings.limitCooldownMs = 1000;

    for (const [name, token] of [["personal", "TOKEN_A"], ["work", "TOKEN_B"]]) {
      const acct = {
        id: `id-${name}`,
        name,
        email: `${name}@gmail.com`,
        plan: null,
        addedAt: new Date().toISOString(),
        lastUsed: null,
        lastQuota: null,
      };
      state.accounts.push(acct);
      await setVaultToken(acct.id, token);
    }
    state.activeAccountId = "id-personal";
    saveState(state);
    await require("../dist/keyring.js").setActiveToken("TOKEN_A");

    const session = new Session(state, mockAgy, [], dir, {
      onSlash: async () => {},
      onLimit: async (signal) => {
        events.push(`limit:${signal.signal}`);
        await handleLimit(session, state, signal);
        events.push("handled");
      },
      onEnd: async () => {
        events.push("end");
      },
    });

    session.launch([]);
    await sleep(1200);
    session.sendToAgy("trigger429\r");
    await waitFor(() => events.includes("handled"), 15000, "limit handled");

    // nothing should have changed
    assert.equal(await getActiveToken(), "TOKEN_A");
    assert.equal(state.activeAccountId, "id-personal");
    assert.ok(session.activeChild, "agy should still be running");
    assert.ok(!events.includes("end"));

    await session.end();
  } finally {
    delete process.env.GEMINISWITCHER_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
