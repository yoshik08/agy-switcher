/* Tests for slash command handlers with a fake session. */
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
const { handleSlashCommand } = require("../dist/commands.js");
const { setVaultToken, setActiveToken } = require("../dist/keyring.js");

function makeCtx(state) {
  const calls = [];
  const fakeSession = {
    cwd: "/tmp",
    conversationId: null,
    busy: false,
    sendToAgy: (t) => calls.push(["sendToAgy", t]),
    restart: async (args) => calls.push(["restart", args]),
  };
  return { ctx: { session: fakeSession, state, quit: async () => calls.push(["quit"]) }, calls };
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

test("commands: /help prints without throwing", async () => {
  const { state, dir } = await seedState();
  try {
    const { ctx } = makeCtx(state);
    await handleSlashCommand("help", [], ctx);
  } finally {
    delete process.env.GEMINISWITCHER_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("commands: /accounts lists", async () => {
  const { state, dir } = await seedState();
  try {
    const { ctx } = makeCtx(state);
    await handleSlashCommand("accounts", [], ctx);
    await handleSlashCommand("list", [], ctx);
  } finally {
    delete process.env.GEMINISWITCHER_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("commands: /autoswitch-off then /autoswitch-on toggle persisted state", async () => {
  const { state, dir } = await seedState();
  try {
    const { ctx } = makeCtx(state);
    await handleSlashCommand("autoswitch-off", [], ctx);
    assert.equal(state.settings.autoswitch, false);
    const reloaded = loadState();
    assert.equal(reloaded.settings.autoswitch, false);
    await handleSlashCommand("autoswitch-on", [], ctx);
    assert.equal(state.settings.autoswitch, true);
  } finally {
    delete process.env.GEMINISWITCHER_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("commands: /switch changes account and restarts", async () => {
  const { state, dir } = await seedState();
  try {
    const { ctx, calls } = makeCtx(state);
    await handleSlashCommand("switch", ["work"], ctx);
    assert.equal(state.activeAccountId, "id-work");
    assert.ok(calls.some((c) => c[0] === "restart"), "expected restart call");
    const restartArgs = calls.find((c) => c[0] === "restart")[1];
    assert.deepEqual(restartArgs, ["-c"]);
  } finally {
    delete process.env.GEMINISWITCHER_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("commands: /switch unknown name errors cleanly", async () => {
  const { state, dir } = await seedState();
  try {
    const { ctx, calls } = makeCtx(state);
    await handleSlashCommand("switch", ["nope"], ctx);
    assert.equal(state.activeAccountId, "id-personal");
    assert.ok(!calls.some((c) => c[0] === "restart"));
  } finally {
    delete process.env.GEMINISWITCHER_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("commands: /usage forwards to agy", async () => {
  const { state, dir } = await seedState();
  try {
    const { ctx, calls } = makeCtx(state);
    await handleSlashCommand("usage", [], ctx);
    assert.ok(
      calls.some((c) => c[0] === "sendToAgy" && c[1] === "/usage\r"),
      "expected /usage forwarded to agy"
    );
  } finally {
    delete process.env.GEMINISWITCHER_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("commands: /handoff writes file only on demand", async () => {
  const { state, dir } = await seedState();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gsw-ho-"));
  try {
    const { ctx } = makeCtx(state);
    ctx.session.cwd = cwd;
    ctx.session.recentOutput = "some output";
    assert.ok(!fs.existsSync(path.join(cwd, "handoff.md")));
    await handleSlashCommand("handoff", [], ctx);
    assert.ok(fs.existsSync(path.join(cwd, "handoff.md")));
    const body = fs.readFileSync(path.join(cwd, "handoff.md"), "utf8");
    assert.ok(body.includes("personal"));
  } finally {
    delete process.env.GEMINISWITCHER_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
