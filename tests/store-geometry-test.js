#!/usr/bin/env node
// Quick unit checks for Store.js / Geometry.js (no Quickshell required).
const assert = require("assert")
const path = require("path")
const root = path.join(__dirname, "..")
const Store = require(path.join(root, "Store.js"))
const Geometry = require(path.join(root, "Geometry.js"))

let s = Store.emptyStore()
s = Store.upsertPosition(s, "org.kde.dolphin", {
  monitor: "DP-1", x: 10, y: 20, w: 800, h: 600, pinned: false
})
assert.strictEqual(Store.listPositions(s).length, 1)
assert.ok(Store.getPosition(s, "org.kde.dolphin"))

const client = {
  initialClass: "org.kde.dolphin",
  class: "dolphin",
  at: [110, 220],
  size: [800, 600],
  monitor: 0,
  pinned: false
}
const mons = [{
  id: 0, name: "DP-1", x: 100, y: 200, width: 1920, height: 1080, scale: 1, focused: true
}]
const rec = Geometry.recordFromClient(client, mons)
assert.strictEqual(rec.x, 10)
assert.strictEqual(rec.y, 20)
const place = Geometry.resolvePlacement(rec, mons)
assert.strictEqual(place.x, 110)
assert.strictEqual(place.y, 220)

s = Store.forgetPosition(s, "org.kde.dolphin")
assert.strictEqual(Store.listPositions(s).length, 0)

const box = Geometry.parseSlurpBox("150,250 1100x800")
assert.strictEqual(box.x, 150)
assert.strictEqual(box.y, 250)
assert.strictEqual(box.w, 1100)
assert.strictEqual(box.h, 800)
const fromBox = Geometry.recordFromBox("org.kde.dolphin", box, mons, false)
assert.strictEqual(fromBox.x, 50)
assert.strictEqual(fromBox.y, 50)

const script = Geometry.applyScript("0xabc", { x: 150, y: 250, w: 1100, h: 800 }, false)
assert.ok(script.indexOf("movewindowpixel") !== -1)
assert.ok(script.indexOf("address:0xabc") !== -1)

// Reject hostile / non-hex addresses — never emit a dispatch script.
assert.strictEqual(Geometry.applyScript('0xabc"; rm -rf /', { x: 1, y: 2, w: 3, h: 4 }, false), "")
assert.strictEqual(Geometry.applyScript("$(reboot)", { x: 1, y: 2, w: 3, h: 4 }, false), "")
assert.strictEqual(Geometry.applyScript("0xabc`id`", { x: 1, y: 2, w: 3, h: 4 }, false), "")
assert.strictEqual(Geometry.applyScript("", { x: 1, y: 2, w: 3, h: 4 }, false), "")
assert.ok(Geometry.isValidAddress("0xDEADBEEF"))
assert.ok(Geometry.isValidAddress("abc123"))
assert.ok(!Geometry.isValidAddress("0xGG"))
assert.strictEqual(Geometry.normalizeAddress("dead"), "0xdead")
assert.strictEqual(Geometry.normalizeAddress("0xDEAD"), "0xDEAD")
assert.strictEqual(Geometry.normalizeAddress("bad;addr"), "")

// Placement numbers must not inject shell via applyScript.
const weird = Geometry.applyScript("0x1", { x: "1; reboot", y: 2, w: 3, h: 4 }, true)
assert.ok(weird.indexOf("reboot") === -1)
assert.ok(weird.indexOf("movewindowpixel exact 0 2,address:0x1") !== -1)

assert.strictEqual(Geometry.shellQuote("a'b"), "'a'\\''b'")
assert.strictEqual(Geometry.luaQuote('a"b\\c'), 'a\\"b\\\\c')

console.log("ok")
