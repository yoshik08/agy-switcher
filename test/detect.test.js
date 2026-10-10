/* Unit tests for pure logic: detect.ts */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseSlash,
  detectLimit,
  extractConversationId,
  extractQuotaSignals,
  extractEmail,
  KNOWN_COMMANDS,
} = require("../dist/detect.js");

test("parseSlash: basic command", () => {
  assert.deepEqual(parseSlash("/switch work"), { cmd: "switch", args: ["work"] });
});

test("parseSlash: no args", () => {
  assert.deepEqual(parseSlash("/accounts"), { cmd: "accounts", args: [] });
});

test("parseSlash: case-insensitive", () => {
  assert.deepEqual(parseSlash("/AutoSwitch-ON"), { cmd: "autoswitch-on", args: [] });
});

test("parseSlash: not a slash command", () => {
  assert.equal(parseSlash("hello"), null);
  assert.equal(parseSlash(""), null);
  assert.equal(parseSlash("/"), null);
});

test("parseSlash: known commands set", () => {
  for (const c of ["add", "accounts", "list", "usage", "switch", "autoswitch-on", "autoswitch-off", "handoff", "help"]) {
    assert.ok(KNOWN_COMMANDS.has(c), c);
  }
});

test("detectLimit: RESOURCE_EXHAUSTED hard hit", () => {
  const r = detectLimit("Error: RESOURCE_EXHAUSTED: quota exceeded for model");
  assert.equal(r.hit, true);
  assert.equal(r.kind, "hard");
});

test("detectLimit: 429 with error context", () => {
  const r = detectLimit("request failed with status 429: too many requests, quota error");
  assert.equal(r.hit, true);
  assert.equal(r.kind, "hard");
});

test("detectLimit: bare 429 in code is not a hit", () => {
  const r = detectLimit("const x = 429; // retry count");
  assert.equal(r.hit, false);
});

test("detectLimit: soft quota warning", () => {
  const r = detectLimit("warning: quota is almost exhausted for this period");
  assert.equal(r.hit, true);
  assert.equal(r.kind, "soft");
});

test("detectLimit: clean output", () => {
  const r = detectLimit("Done. Wrote 3 files in 1.2s.");
  assert.equal(r.hit, false);
});

test("extractConversationId: finds ids", () => {
  assert.equal(extractConversationId("conversation id: abc123XYZ"), "abc123XYZ");
  assert.equal(extractConversationId("Session ID=xyz-789"), "xyz-789");
  assert.equal(extractConversationId("nothing here"), null);
});

test("extractConversationId: no false positive on prose", () => {
  assert.equal(extractConversationId("resumed previous conversation\nmock-agy ready"), null);
});

test("extractQuotaSignals: percent remaining", () => {
  const q = extractQuotaSignals("Usage: 62% remaining this period");
  assert.equal(q.quotaText, "62% remaining");
});

test("extractQuotaSignals: plan detection", () => {
  const q = extractQuotaSignals("Plan: Google AI Pro active");
  assert.equal(q.plan, "AI Pro");
});

test("extractEmail: JWT payload", () => {
  const payload = Buffer.from(JSON.stringify({ email: "foo@gmail.com" })).toString("base64url");
  const jwt = `header.${payload}.sig`;
  assert.equal(extractEmail(jwt), "foo@gmail.com");
});

test("extractEmail: JSON blob", () => {
  assert.equal(extractEmail(JSON.stringify({ email: "bar@gmail.com", x: 1 })), "bar@gmail.com");
});

test("extractEmail: opaque string → null", () => {
  assert.equal(extractEmail("opaque-refresh-token-xyz"), null);
});
