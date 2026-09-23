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
assert.strictEqual(rec.key, "org.kde.dolphin")
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

// class::title keys distinguish same-app pop-ups.
assert.strictEqual(
  Geometry.windowKey({
    initialClass: "org.mozilla.Thunderbird",
    initialTitle: "Team standup",
    title: "Team standup"
  }),
  "org.mozilla.Thunderbird::Team standup"
)
assert.strictEqual(
  Geometry.windowKey({ class: "KeePassXC", title: "  Passwords :: Home  " }),
  "KeePassXC::Passwords - Home"
)
assert.strictEqual(
  Geometry.windowKey({ class: "Evil", title: '<img src="http://x/y">' }),
  "Evil::img src=\"http://x/y\""
)
assert.strictEqual(Geometry.classOfKey("org.mozilla.Thunderbird::Dentist"), "org.mozilla.Thunderbird")
assert.strictEqual(Geometry.titleOfKey("org.mozilla.Thunderbird::Dentist"), "Dentist")

const reminder = { monitor: "DP-1", x: 50, y: 50, w: 500, h: 400, pinned: false, updatedAt: 100 }
const compose = { monitor: "DP-1", x: 80, y: 80, w: 900, h: 700, pinned: false, updatedAt: 200 }
let multi = Store.emptyStore()
multi = Store.upsertPosition(multi, "org.mozilla.Thunderbird::Team standup", reminder)
multi = Store.upsertPosition(multi, "org.mozilla.Thunderbird::Write", compose)
assert.ok(Geometry.hasClassEntry(multi, "org.mozilla.Thunderbird"))
assert.ok(!Geometry.hasClassEntry(multi, "org.kde.dolphin"))

// Exact title wins.
let hit = Geometry.findPosition(multi, "org.mozilla.Thunderbird", "Team standup", [510, 410], { width: 1920, height: 1080 })
assert.strictEqual(hit.key, "org.mozilla.Thunderbird::Team standup")

// Different reminder title still maps to the closest size-compatible sibling.
hit = Geometry.findPosition(multi, "org.mozilla.Thunderbird", "Dentist", [520, 390], { width: 1920, height: 1080 })
assert.strictEqual(hit.key, "org.mozilla.Thunderbird::Team standup")

// Fuzzy title prefers the matching wallet-style subject among similar sizes.
const walletA = { monitor: "DP-1", x: 40, y: 40, w: 420, h: 640, pinned: false, updatedAt: 100 }
const walletB = { monitor: "DP-1", x: 40, y: 40, w: 430, h: 650, pinned: false, updatedAt: 200 }
let wallets = Store.emptyStore()
wallets = Store.upsertPosition(wallets, "Brave-browser::Confirm transaction", walletA)
wallets = Store.upsertPosition(wallets, "Brave-browser::Signature request", walletB)
hit = Geometry.findPosition(
  wallets,
  "Brave-browser",
  "Confirm transaction - Account 2",
  [425, 645],
  { width: 1920, height: 1080 }
)
assert.strictEqual(hit.key, "Brave-browser::Confirm transaction")

// Main Thunderbird window is much larger — size gate / popup role skips restores.
hit = Geometry.findPosition(multi, "org.mozilla.Thunderbird", "Inbox", [1600, 1000], { width: 1920, height: 1080 })
assert.strictEqual(hit, null)
assert.strictEqual(Geometry.popupRole([1600, 1000], { width: 1920, height: 1080 }), "main")
assert.strictEqual(Geometry.popupRole([500, 400], { width: 1920, height: 1080 }), "popup")

// Distinct compose vs reminder sizes stay as separate layouts.
hit = Geometry.findPosition(multi, "org.mozilla.Thunderbird", "Re: hello", [910, 710], { width: 1920, height: 1080 })
assert.strictEqual(hit.key, "org.mozilla.Thunderbird::Write")

// Legacy bare class key still works for similarly sized windows.
let legacy = Store.emptyStore()
legacy = Store.upsertPosition(legacy, "org.mozilla.Thunderbird", reminder)
hit = Geometry.findPosition(legacy, "org.mozilla.Thunderbird", "Anything", [500, 400], { width: 1920, height: 1080 })
assert.strictEqual(hit.key, "org.mozilla.Thunderbird")
hit = Geometry.findPosition(legacy, "org.mozilla.Thunderbird", "Inbox", [1800, 1100], { width: 1920, height: 1080 })
assert.strictEqual(hit, null)

assert.ok(Geometry.sizeCompatible(reminder, [500, 400]))
assert.ok(!Geometry.sizeCompatible(reminder, [1600, 1000]))
assert.ok(Geometry.titleFuzzyScore("Confirm transaction Account 1", "Confirm transaction Account 2") > 0.4)
assert.ok(Geometry.areasSimilar(500 * 400, 520 * 390))
assert.ok(!Geometry.areasSimilar(500 * 400, 900 * 700))

const explained = Geometry.explainFindPosition(
  multi, "org.mozilla.Thunderbird", "Dentist", [520, 390], { width: 1920, height: 1080 }
)
assert.strictEqual(explained.match.key, "org.mozilla.Thunderbird::Team standup")
assert.strictEqual(explained.reason, "sibling")
assert.ok(explained.candidates.length >= 2)
assert.ok(Geometry.formatMatchExplain(explained).indexOf("restore") === 0)

const skipped = Geometry.explainFindPosition(
  multi, "org.mozilla.Thunderbird", "Inbox", [1600, 1000], { width: 1920, height: 1080 }
)
assert.strictEqual(skipped.match, null)
assert.strictEqual(skipped.reason, "main-skip")
assert.ok(Geometry.formatMatchExplain(skipped).indexOf("skip") === 0)

// Wallet/extension class: only popup saves exist — force-shrink a huge tiled open.
const rabbyClass = "brave-acmacodkjbdgmoleebolmdjonilkdbch-Default"
const rabbySave = { monitor: "DP-1", x: 2600, y: 80, w: 375, h: 911, pinned: false, updatedAt: 100 }
let rabby = Store.emptyStore()
rabby = Store.upsertPosition(rabby, rabbyClass + "::_crx_acmacodkjbdgmoleebolmdjonilkdbch", rabbySave)
rabby = Store.upsertPosition(rabby, rabbyClass, rabbySave)
const walletOpen = Geometry.explainFindPosition(
  rabby,
  rabbyClass,
  "Rabby Wallet Notification",
  [1517, 1678],
  { width: 3072, height: 1728 }
)
assert.ok(walletOpen.match, "wallet should force-restore")
assert.ok(walletOpen.forceShrink)
assert.ok(walletOpen.reason === "bare-class" || walletOpen.reason === "crx-title")
assert.strictEqual(walletOpen.match.record.w, 375)

// Saving a similar-sized dialog reuses the existing layout key.
assert.strictEqual(
  Geometry.resolveSaveKey(multi, {
    initialClass: "org.mozilla.Thunderbird",
    title: "Dental checkup"
  }, [510, 405]),
  "org.mozilla.Thunderbird::Team standup"
)
assert.strictEqual(
  Geometry.resolveSaveKey(multi, {
    initialClass: "org.mozilla.Thunderbird",
    title: "Write: New"
  }, [905, 695]),
  "org.mozilla.Thunderbird::Write"
)

const titledClient = {
  initialClass: "org.mozilla.Thunderbird",
  initialTitle: "Alarm",
  at: [150, 250],
  size: [500, 400],
  monitor: 0
}
const titledRec = Geometry.recordFromClient(titledClient, mons)
assert.strictEqual(titledRec.key, "org.mozilla.Thunderbird::Alarm")
const reused = Geometry.recordFromClientInStore(multi, titledClient, mons)
assert.strictEqual(reused.key, "org.mozilla.Thunderbird::Team standup")

console.log("ok")
