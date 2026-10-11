/* Tests for input router modes and palette. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { InputRouter } = require("../dist/input.js");
const { Palette } = require("../dist/palette.js");

function makeRouter() {
  const events = { agy: [], paletteOpened: [], paletteKeys: [], blocking: [] };
  const r = new InputRouter({
    onAgyKey: (ch) => events.agy.push(ch),
    onPaletteOpen: (pre) => events.paletteOpened.push(pre),
    onPaletteKey: (ch) => events.paletteKeys.push(ch),
    onBlockingKey: (ch) => {
      events.blocking.push(ch);
      return true;
    },
  });
  return { r, events };
}

test("router: normal typing goes to agy", () => {
  const { r, events } = makeRouter();
  for (const ch of "hello") r.handleKey(ch);
  assert.deepEqual(events.agy, ["h", "e", "l", "l", "o"]);
  assert.equal(events.paletteOpened.length, 0);
});

test("router: slash on empty line opens palette (swallowed)", () => {
  const { r, events } = makeRouter();
  r.handleKey("/");
  assert.deepEqual(events.paletteOpened, ["/"]);
  assert.deepEqual(events.agy, []);
});

test("router: slash mid-line goes to agy", () => {
  const { r, events } = makeRouter();
  for (const ch of "a/b") r.handleKey(ch);
  assert.ok(events.agy.includes("/"));
  assert.equal(events.paletteOpened.length, 0);
});

test("router: ctrl+g opens palette anytime", () => {
  const { r, events } = makeRouter();
  for (const ch of "partial") r.handleKey(ch);
  r.handleKey("\x07");
  assert.deepEqual(events.paletteOpened, ["/"]);
});

test("router: palette mode routes to palette", () => {
  const { r, events } = makeRouter();
  r.setMode("palette");
  r.handleKey("x");
  assert.deepEqual(events.paletteKeys, ["x"]);
  assert.deepEqual(events.agy, []);
});

test("router: blocking mode swallows", () => {
  const { r, events } = makeRouter();
  r.setMode("blocking");
  r.handleKey("x");
  assert.deepEqual(events.blocking, ["x"]);
  assert.deepEqual(events.agy, []);
});

test("router: enter resets line tracking", () => {
  const { r, events } = makeRouter();
  for (const ch of "hi") r.handleKey(ch);
  r.handleKey("\r");
  r.handleKey("/");
  assert.deepEqual(events.paletteOpened, ["/"]);
});

const CMDS = [
  { name: "switch", usage: "/switch <name>", description: "switch account", completeArg: (p) => ["personal", "work"].filter((n) => n.startsWith(p)) },
  { name: "accounts", usage: "/accounts", description: "list accounts" },
  { name: "usage", usage: "/usage", description: "quota" },
];

function makePalette() {
  const out = [];
  const fakeTerm = { write: (s) => out.push(s) };
  return { p: new Palette(fakeTerm, CMDS), out };
}

test("palette: filters as you type", () => {
  const { p } = makePalette();
  p.open("/");
  assert.equal(p.handleKey("s"), "open");
  assert.equal(p.handleKey("w"), "open");
  const res = p.handleKey("\r");
  assert.equal(res, "done");
  assert.deepEqual(p.result, { cmd: "switch", args: [] });
});

test("palette: tab completes command name", () => {
  const { p } = makePalette();
  p.open("/");
  p.handleKey("s");
  p.handleKey("w");
  p.handleKey("\t");
  const res = p.handleKey("\r");
  assert.equal(res, "done");
  assert.deepEqual(p.result, { cmd: "switch", args: [] });
});

test("palette: tab completes account arg", () => {
  const { p } = makePalette();
  p.open("/");
  for (const ch of "switch ") p.handleKey(ch);
  p.handleKey("p");
  p.handleKey("\t");
  const res = p.handleKey("\r");
  assert.equal(res, "done");
  assert.deepEqual(p.result, { cmd: "switch", args: ["personal"] });
});

test("palette: esc cancels", () => {
  const { p } = makePalette();
  p.open("/");
  p.handleKey("x");
  assert.equal(p.handleKey("\x1b"), "cancelled");
  assert.equal(p.result, null);
  assert.equal(p.isOpen, false);
});

test("palette: unknown command still submits", () => {
  const { p } = makePalette();
  p.open("/");
  for (const ch of "frobnicate") p.handleKey(ch);
  assert.equal(p.handleKey("\r"), "done");
  assert.deepEqual(p.result, { cmd: "frobnicate", args: [] });
});
