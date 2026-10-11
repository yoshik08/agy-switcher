/* Tests for v2 command implementations via CmdEnv. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const kv = new Map();
const mockKeytar = {
  getPassword: async (s, a) => (kv.has(`${s}:${a}`) ? kv.get(`${s}:${a}`) : null),
  setPassword: async (s, a, p) => {
    kv.set(`${s}:${a}`, p);
  },
  deletePassword: async (s, a) => {
    kv.delete(`${s}:${a}`);
  },
};
const keytarPath = require.resolve("keytar");
if (!require.cache[keytarPath]) {
  require.cache[keytarPath] = { id: keytarPath, filename: keytarPath, loaded: true, exports: mockKeytar };
}

const { loadState, saveState } = require("../dist/store.js");
const { runCommand, commandRegistry } = require("../dist/commands.js");
const { setVaultToken, setActiveToken } = require("../dist/keyring.js");

function makeEnv(state) {
  const calls = [];
  return {
    env: {
      state,
      switchTo: async (a, reason) => calls.push(["switchTo", a.name, reason]),
      addAccount: async () => calls.push(["addAccount"]),
      setAutoswitch: (on) => {
        state.settings.autoswitch = on;
        saveState(state);
        calls.push(["setAutoswitch", on]);
      },
      writeHandoff: (reason) => calls.push(["writeHandoff", reason]),
      forwardToAgy: (t) => calls.push(["forwardToAgy", t]),
      accountNames: (partial) =>
        state.accounts.map((a) => a.name).filter((n) => n.toLowerCase().startsWith(partial)),
    },
    calls,
  };
}

async function seedState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsw-cmd-"));
  process.env.GEMINISWITCHER_DIR = dir;
  const state = loadState();
  for (const [name, token] of [["personal", "TOKEN_A"], ["work", "TOKEN_B"]]) {
    state.accounts.push({
      id: `id-${name}`,
      name,
      email: `${name}@gmail.com`,
      plan: "AI Pro",
      addedAt: new Date().toISOString(),
      lastUsed: null,
      lastQuota: null,
    });
    await setVaultToken(`id-${name}`, token);
  }
  state.activeAccountId = "id-personal";
  state.settings.autoswitch = true;
  saveState(state);
  await setActiveToken("TOKEN_A");
  return { state, dir };
}

function cleanup(dir) {
  delete process.env.GEMINISWITCHER_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
}

test("registry: all required commands present", async () => {
  const { state, dir } = await seedState();
  try {
    const { env } = makeEnv(state);
    const names = commandRegistry(env).map((c) => c.name);
    for (const c of ["add", "accounts", "usage", "switch", "autoswitch-on", "autoswitch-off", "handoff", "help"]) {
      assert.ok(names.includes(c), c);
    }
    const sw = commandRegistry(env).find((c) => c.name === "switch");
    assert.deepEqual(sw.completeArg("per"), ["personal"]);
    assert.deepEqual(sw.completeArg(""), ["personal", "work"]);
  } finally {
    cleanup(dir);
  }
});

test("commands: /accounts and /list run", async () => {
  const { state, dir } = await seedState();
  try {
    const { env } = makeEnv(state);
    await runCommand("accounts", [], env);
    await runCommand("list", [], env);
  } finally {
    cleanup(dir);
  }
});

test("commands: autoswitch toggle persists", async () => {
  const { state, dir } = await seedState();
  try {
    const { env, calls } = makeEnv(state);
    await runCommand("autoswitch-off", [], env);
    assert.equal(loadState().settings.autoswitch, false);
    assert.ok(calls.some((c) => c[0] === "setAutoswitch" && c[1] === false));
    await runCommand("autoswitch-on", [], env);
    assert.equal(loadState().settings.autoswitch, true);
  } finally {
    cleanup(dir);
  }
});

test("commands: /switch dispatches with fuzzy match", async () => {
  const { state, dir } = await seedState();
  try {
    const { env, calls } = makeEnv(state);
    await runCommand("switch", ["wor"], env);
    assert.ok(calls.some((c) => c[0] === "switchTo" && c[1] === "work"));
  } finally {
    cleanup(dir);
  }
});

test("commands: /switch unknown name does not dispatch", async () => {
  const { state, dir } = await seedState();
  try {
    const { env, calls } = makeEnv(state);
    await runCommand("switch", ["nope"], env);
    assert.ok(!calls.some((c) => c[0] === "switchTo"));
  } finally {
    cleanup(dir);
  }
});

test("commands: /usage forwards to agy", async () => {
  const { state, dir } = await seedState();
  try {
    const { env, calls } = makeEnv(state);
    await runCommand("usage", [], env);
    assert.ok(calls.some((c) => c[0] === "forwardToAgy" && c[1] === "/usage\r"));
  } finally {
    cleanup(dir);
  }
});

test("commands: /help prints", async () => {
  const { state, dir } = await seedState();
  try {
    const { env } = makeEnv(state);
    await runCommand("help", [], env);
  } finally {
    cleanup(dir);
  }
});
