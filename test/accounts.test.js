/* Unit tests for accounts.ts pure helpers and store.ts roundtrip. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { slugify, findAccounts, pickNextAccount } = require("../dist/accounts.js");

function mkAccount(id, name, lastUsed) {
  return { id, name, email: null, plan: null, addedAt: "2026-01-01T00:00:00.000Z", lastUsed, lastQuota: null };
}

test("slugify", () => {
  assert.equal(slugify("My Work Account!"), "my-work-account");
  assert.equal(slugify("!!!"), "account");
  assert.ok(slugify("a".repeat(100)).length <= 24);
});

test("findAccounts: fuzzy match", () => {
  const state = { accounts: [mkAccount("a1", "personal", null), mkAccount("b2", "work", null)] };
  assert.equal(findAccounts(state, "pers").length, 1);
  assert.equal(findAccounts(state, "WORK")[0].name, "work");
  assert.equal(findAccounts(state, "zzz").length, 0);
});

test("pickNextAccount: least recently used, excludes current", () => {
  const state = {
    activeAccountId: "a1",
    accounts: [
      mkAccount("a1", "personal", "2026-10-01T00:00:00.000Z"),
      mkAccount("b2", "work", "2026-09-01T00:00:00.000Z"),
      mkAccount("c3", "side", "2026-09-15T00:00:00.000Z"),
    ],
  };
  assert.equal(pickNextAccount(state).id, "b2");
});

test("pickNextAccount: none available", () => {
  const state = { activeAccountId: "a1", accounts: [mkAccount("a1", "personal", null)] };
  assert.equal(pickNextAccount(state), null);
});

test("store: save/load roundtrip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsw-test-"));
  process.env.GEMINISWITCHER_DIR = dir;
  try {
    // require fresh after env set (config.ts reads env lazily via function, ok)
    const { loadState, saveState } = require("../dist/store.js");
    const s = loadState();
    assert.equal(s.accounts.length, 0);
    assert.equal(s.settings.autoswitch, true);
    s.accounts.push(mkAccount("x1", "testy", null));
    s.settings.autoswitch = false;
    saveState(s);
    const s2 = loadState();
    assert.equal(s2.accounts.length, 1);
    assert.equal(s2.accounts[0].name, "testy");
    assert.equal(s2.settings.autoswitch, false);
    // file should be 0600
    const mode = fs.statSync(path.join(dir, "state.json")).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    delete process.env.GEMINISWITCHER_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
