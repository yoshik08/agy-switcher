/* Tests for limits.ts: LimitDetector, SwitchGuard, extractConversationId. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { LimitDetector, SwitchGuard, extractConversationId } = require("../dist/limits.js");

test("detector: RESOURCE_EXHAUSTED is hard", () => {
  const d = new LimitDetector();
  const ev = d.scan("Error: RESOURCE_EXHAUSTED: quota exceeded for model");
  assert.ok(ev && ev.kind === "hard");
});

test("detector: 429 with error context is hard", () => {
  const d = new LimitDetector();
  assert.ok(d.scan("request failed: 429 too many requests"));
  assert.ok(d.scan("error 429: quota error"));
});

test("detector: bare 429 in pasted code is ignored when it echoes user input", () => {
  const d = new LimitDetector();
  d.noteUserInput("const retries = 429;");
  assert.equal(d.scan("you said: const retries = 429;"), null);
});

test("detector: bare 429 without context is not hard", () => {
  const d = new LimitDetector();
  assert.equal(d.scan("status code: 429"), null);
});

test("detector: soft quota hint", () => {
  const d = new LimitDetector();
  const ev = d.scan("warning: quota is almost exhausted for this period");
  assert.ok(ev && ev.kind === "soft");
});

test("detector: clean output", () => {
  const d = new LimitDetector();
  assert.equal(d.scan("Done. Wrote 3 files."), null);
});

test("guard: trips after max switches in window", () => {
  const g = new SwitchGuard(2, 10 * 60_000);
  assert.equal(g.tripped(), false);
  g.record();
  assert.equal(g.tripped(), false);
  g.record();
  assert.equal(g.tripped(), true);
  g.reset();
  assert.equal(g.tripped(), false);
});

test("extractConversationId: strict patterns", () => {
  assert.equal(extractConversationId("conversation id: abc123XYZ"), "abc123XYZ");
  assert.equal(extractConversationId("Session ID=xyz-789"), "xyz-789");
  assert.equal(extractConversationId("nothing here"), null);
  assert.equal(extractConversationId("resumed previous conversation\nmock-agy ready"), null);
});
