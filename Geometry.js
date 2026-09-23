// Window/monitor geometry helpers for omafloat.

var KEY_SEP = "::"
// Reject restore when the live window is clearly larger than the saved popup.
var SIZE_DIM_RATIO = 1.8
var SIZE_AREA_RATIO = 2.5
// Looser gate for clearly-small pop-ups whose mapped size drifts a bit.
var SIZE_DIM_RATIO_LOOSE = 2.6
var SIZE_AREA_RATIO_LOOSE = 4.5
// Fraction of monitor area: below → popup, above → main (mid is uncertain).
var POPUP_MONITOR_RATIO = 0.40
var MAIN_MONITOR_RATIO = 0.55
// Areas within this factor share one layout bucket (same style of dialog).
var SIMILAR_AREA_RATIO = 1.65

function windowClass(client) {
  if (!client || typeof client !== "object") return ""
  var initial = String(client.initialClass || "").trim()
  if (initial) return initial
  return String(client.class || "").trim()
}

function sanitizeTitle(title) {
  var text = String(title || "")
  // Keep keys JSON-safe and avoid colliding with the class::title separator.
  text = text.replace(/::/g, " - ")
  // Drop markup delimiters so titles cannot feed rich-text sinks later.
  text = text.replace(/[<>]/g, "")
  text = text.replace(/\s+/g, " ").trim()
  if (!text) return ""
  if (text.length > 120) text = text.slice(0, 120)
  return text
}

function windowTitle(client) {
  if (!client || typeof client !== "object") return ""
  var initial = sanitizeTitle(client.initialTitle)
  var title = sanitizeTitle(client.title)
  // Chromium extension pop-ups keep an opaque _crx_* initialTitle; prefer the live label.
  if (initial && initial.indexOf("_crx_") === 0 && title) return title
  if (initial) return initial
  return title
}

// Prefer class::title so pop-ups of the same app can keep separate layouts.
function windowKey(client) {
  var cls = windowClass(client)
  if (!cls) return ""
  var title = windowTitle(client)
  if (title) return cls + KEY_SEP + title
  return cls
}

function classOfKey(key) {
  var id = String(key || "")
  var idx = id.indexOf(KEY_SEP)
  return idx === -1 ? id : id.slice(0, idx)
}

function titleOfKey(key) {
  var id = String(key || "")
  var idx = id.indexOf(KEY_SEP)
  return idx === -1 ? "" : id.slice(idx + KEY_SEP.length)
}

function clientArea(size) {
  if (!size || typeof size !== "object") return 0
  var w = Math.max(0, Math.round(Number(size[0] || size.w) || 0))
  var h = Math.max(0, Math.round(Number(size[1] || size.h) || 0))
  return w * h
}

function monitorArea(monitorSize) {
  if (!monitorSize || typeof monitorSize !== "object") return 0
  var w = Math.max(0, Math.round(Number(monitorSize.width || monitorSize[0] || monitorSize.w) || 0))
  var h = Math.max(0, Math.round(Number(monitorSize.height || monitorSize[1] || monitorSize.h) || 0))
  return w * h
}

// "popup" | "main" | "mid" | "unknown" — based on live area vs monitor.
function popupRole(clientSize, monitorSize) {
  var live = clientArea(clientSize)
  var mon = monitorArea(monitorSize)
  if (live < 1 || mon < 1) return "unknown"
  var ratio = live / mon
  if (ratio >= MAIN_MONITOR_RATIO) return "main"
  if (ratio <= POPUP_MONITOR_RATIO) return "popup"
  return "mid"
}

function recordArea(record) {
  if (!record) return 0
  return Math.max(1, Math.round(Number(record.w) || 0) * Math.round(Number(record.h) || 0))
}

function areasSimilar(a, b) {
  var aa = Math.max(1, a)
  var bb = Math.max(1, b)
  var hi = Math.max(aa, bb)
  var lo = Math.min(aa, bb)
  return hi <= lo * SIMILAR_AREA_RATIO
}

function sizeCompatibleWith(record, clientSize, dimRatio, areaRatio) {
  if (!record) return false
  var rw = Math.max(1, Math.round(Number(record.w) || 0))
  var rh = Math.max(1, Math.round(Number(record.h) || 0))
  if (!clientSize) return true
  var cw = Math.max(0, Math.round(Number(clientSize[0] || clientSize.w) || 0))
  var ch = Math.max(0, Math.round(Number(clientSize[1] || clientSize.h) || 0))
  // Unknown size yet — allow and let a later probe decide.
  if (cw < 1 || ch < 1) return true
  if (cw > rw * dimRatio && ch > rh * dimRatio) return false
  if (cw * ch > rw * rh * areaRatio) return false
  return true
}

// True when the live window is still in the same "popup" size class as the save.
function sizeCompatible(record, clientSize) {
  return sizeCompatibleWith(record, clientSize, SIZE_DIM_RATIO, SIZE_AREA_RATIO)
}

function sizeCompatibleLoose(record, clientSize) {
  return sizeCompatibleWith(record, clientSize, SIZE_DIM_RATIO_LOOSE, SIZE_AREA_RATIO_LOOSE)
}

function titleTokens(title) {
  var text = sanitizeTitle(title).toLowerCase()
  if (!text) return []
  var parts = text.split(/[^a-z0-9]+/)
  var out = []
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].length >= 3) out.push(parts[i])
  }
  return out
}

// 0..1 shared-token score for fuzzy title matching (wallet/email subjects).
function titleFuzzyScore(a, b) {
  var ta = titleTokens(a)
  var tb = titleTokens(b)
  if (!ta.length || !tb.length) return 0
  var seen = {}
  for (var i = 0; i < tb.length; i++) seen[tb[i]] = true
  var shared = 0
  for (var j = 0; j < ta.length; j++) {
    if (seen[ta[j]]) shared++
  }
  return shared / Math.max(ta.length, tb.length)
}

function keysForClass(store, className) {
  var cls = String(className || "").trim()
  var rows = []
  if (!cls || !store || !store.positions) return rows
  var prefix = cls + KEY_SEP
  for (var key in store.positions) {
    var record = store.positions[key]
    if (!record || typeof record !== "object") continue
    if (key === cls || key.indexOf(prefix) === 0) {
      rows.push({ key: key, record: record })
    }
  }
  return rows
}

function hasClassEntry(store, className) {
  return keysForClass(store, className).length > 0
}

// Among same-class saves, find a layout whose size is in the same style bucket.
function findSimilarLayout(store, className, clientSize) {
  var cls = String(className || "").trim()
  var liveArea = clientArea(clientSize)
  if (!cls || liveArea < 1) return null
  var candidates = keysForClass(store, cls)
  var best = null
  var bestDelta = Infinity
  for (var i = 0; i < candidates.length; i++) {
    var row = candidates[i]
    var saved = recordArea(row.record)
    if (!areasSimilar(saved, liveArea)) continue
    var delta = Math.abs(saved - liveArea)
    if (!best || delta < bestDelta) {
      best = row
      bestDelta = delta
    }
  }
  return best
}

// Reuse an existing size-similar key so changing subjects share one layout.
function resolveSaveKey(store, client, clientSize) {
  var key = windowKey(client)
  if (!key) return ""
  var similar = findSimilarLayout(store, windowClass(client), clientSize || (client && client.size))
  if (similar && similar.key) return similar.key
  return key
}

function pickBestCandidate(candidates, wantTitle, liveArea) {
  if (!candidates.length) return null
  var best = null
  var bestSizeDelta = Infinity
  var bestFuzzy = -1
  var bestUpdated = -1
  for (var i = 0; i < candidates.length; i++) {
    var row = candidates[i]
    var savedArea = recordArea(row.record)
    var sizeDelta = liveArea > 0
      ? Math.abs(savedArea - liveArea)
      : (1e15 - (Number(row.record.updatedAt) || 0))
    var fuzzy = titleFuzzyScore(wantTitle, titleOfKey(row.key))
    var updated = Number(row.record.updatedAt) || 0
    var better = false
    if (!best) {
      better = true
    } else if (liveArea > 0 && areasSimilar(savedArea, recordArea(best.record))) {
      // Same style of dialog — prefer fuzzy title, then newer save.
      if (fuzzy > bestFuzzy + 0.001) better = true
      else if (Math.abs(fuzzy - bestFuzzy) <= 0.001 && sizeDelta < bestSizeDelta) better = true
      else if (Math.abs(fuzzy - bestFuzzy) <= 0.001 && sizeDelta === bestSizeDelta && updated > bestUpdated) better = true
    } else if (sizeDelta < bestSizeDelta) {
      better = true
    } else if (sizeDelta === bestSizeDelta && fuzzy > bestFuzzy) {
      better = true
    }
    if (better) {
      best = row
      bestSizeDelta = sizeDelta
      bestFuzzy = fuzzy
      bestUpdated = updated
    }
  }
  return best
}

// Explain + resolve the best remembered layout for an opening window.
// Returns { match, reason, role, live, candidates } for the match log.
function explainFindPosition(store, className, title, clientSize, monitorSize) {
  var cls = String(className || "").trim()
  var wantTitle = sanitizeTitle(title)
  var role = popupRole(clientSize, monitorSize)
  var liveArea = clientArea(clientSize)
  var mon = monitorArea(monitorSize)
  var loose = role === "popup" || role === "unknown"
  var cw = clientSize ? Math.max(0, Math.round(Number(clientSize[0] || clientSize.w) || 0)) : 0
  var ch = clientSize ? Math.max(0, Math.round(Number(clientSize[1] || clientSize.h) || 0)) : 0
  var empty = {
    match: null,
    reason: "no-class",
    role: role,
    className: cls,
    title: wantTitle,
    live: { w: cw, h: ch, area: liveArea },
    candidates: []
  }
  if (!cls || !store || !store.positions) return empty

  var rows = keysForClass(store, cls)

  // Extension/wallet windows often open tiled huge. Detect those classes and
  // force-shrink into the remembered pop-up box (exact, bare, or _crx_ key).
  function classLooksLikeExtensionPopup() {
    if (/^brave-[a-z0-9]+-Default$/i.test(cls)) return true
    if (/^chrome-[a-z0-9]+-Default$/i.test(cls)) return true
    for (var i = 0; i < rows.length; i++) {
      if (titleOfKey(rows[i].key).indexOf("_crx_") === 0) return true
    }
    return false
  }
  function classOnlyHasPopups() {
    if (!rows.length || mon < 1) return false
    for (var j = 0; j < rows.length; j++) {
      if (recordArea(rows[j].record) / mon > POPUP_MONITOR_RATIO) return false
    }
    return true
  }
  var forceShrink = classLooksLikeExtensionPopup() && classOnlyHasPopups()

  function rejectReason(record, mode) {
    if (!record) return "missing"
    // Exact/bare (or popup-only classes): reshape even when Chromium opens them huge.
    if (mode === "force" || (forceShrink && mode === "sibling")) return ""
    if (!(sizeCompatible(record, clientSize) || (loose && sizeCompatibleLoose(record, clientSize))))
      return "size"
    if (role === "main" && mon > 0 && recordArea(record) / mon <= POPUP_MONITOR_RATIO)
      return "main-vs-popup"
    if (role === "popup" && mon > 0 && recordArea(record) / mon >= MAIN_MONITOR_RATIO)
      return "popup-vs-main"
    return ""
  }

  function accept(record, mode) {
    return rejectReason(record, mode || "sibling") === ""
  }

  function describeRow(key, record) {
    var why = rejectReason(record, forceShrink ? "force" : "sibling")
    return {
      key: key,
      w: Math.round(Number(record && record.w) || 0),
      h: Math.round(Number(record && record.h) || 0),
      fuzzy: Math.round(titleFuzzyScore(wantTitle, titleOfKey(key)) * 100) / 100,
      ok: why === "",
      reject: why
    }
  }

  var candidates = []
  for (var r = 0; r < rows.length; r++) {
    candidates.push(describeRow(rows[r].key, rows[r].record))
  }

  function done(match, reason) {
    return {
      match: match,
      reason: reason,
      role: role,
      className: cls,
      title: wantTitle,
      live: { w: cw, h: ch, area: liveArea },
      forceShrink: forceShrink,
      candidates: candidates
    }
  }

  var exactKey = wantTitle ? (cls + KEY_SEP + wantTitle) : ""
  if (exactKey && store.positions[exactKey] && accept(store.positions[exactKey], forceShrink ? "force" : "sibling")) {
    return done({ key: exactKey, record: store.positions[exactKey] }, "exact-title")
  }

  // Bare class: size-gated unless this is a popup-only extension/wallet class.
  if (store.positions[cls] && accept(store.positions[cls], forceShrink ? "force" : "sibling")) {
    return done({ key: cls, record: store.positions[cls] }, "bare-class")
  }

  // Chromium wallets keep a stable _crx_* key even after the live title changes.
  for (var c = 0; c < rows.length; c++) {
    var ck = rows[c].key
    var ct = titleOfKey(ck)
    if (ct && ct.indexOf("_crx_") === 0 && accept(rows[c].record, "force")) {
      return done({ key: ck, record: rows[c].record }, "crx-title")
    }
  }

  // Main windows of apps that also have large saves stop here.
  if (role === "main" && !forceShrink) return done(null, "main-skip")

  var accepted = []
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === cls) continue
    if (accept(rows[i].record, "sibling")) accepted.push(rows[i])
  }
  if (!accepted.length) {
    return done(null, candidates.length ? "none-accepted" : "no-candidates")
  }
  var best = pickBestCandidate(accepted, wantTitle, liveArea)
  if (!best) return done(null, "none-accepted")
  return done(best, forceShrink ? "sibling-force" : "sibling")
}

function findPosition(store, className, title, clientSize, monitorSize) {
  return explainFindPosition(store, className, title, clientSize, monitorSize).match
}

// One-line summary for console / matchLog IPC.
function formatMatchExplain(explained) {
  var e = explained || {}
  var live = e.live || {}
  var title = String(e.title || "")
  if (title.length > 40) title = title.slice(0, 37) + "..."
  var parts = [
    e.match ? "restore" : "skip",
    String(e.className || "?"),
    '"' + title + '"',
    (live.w || 0) + "x" + (live.h || 0),
    "role=" + (e.role || "?"),
    "why=" + (e.reason || "?")
  ]
  if (e.match && e.match.key) parts.push("→ " + e.match.key)
  var cands = e.candidates || []
  if (cands.length) {
    var bits = []
    for (var i = 0; i < cands.length && i < 6; i++) {
      var c = cands[i]
      bits.push(c.key + (c.ok ? "" : "/" + c.reject) + "(fz=" + c.fuzzy + ")")
    }
    if (cands.length > 6) bits.push("+" + (cands.length - 6) + "more")
    parts.push("cands=[" + bits.join("; ") + "]")
  }
  return parts.join(" ")
}

function eventParts(event, count) {
  try {
    if (event && event.parse) return event.parse(count)
  } catch (error) {
  }
  return String(event && event.data ? event.data : "").split(",")
}

function findMonitorByName(monitors, name) {
  var want = String(name || "")
  if (!want || !Array.isArray(monitors)) return null
  for (var i = 0; i < monitors.length; i++) {
    if (String(monitors[i].name || "") === want) return monitors[i]
  }
  return null
}

function findMonitorById(monitors, id) {
  if (!Array.isArray(monitors)) return null
  var want = Number(id)
  for (var i = 0; i < monitors.length; i++) {
    if (Number(monitors[i].id) === want) return monitors[i]
  }
  return null
}

function focusedMonitor(monitors) {
  if (!Array.isArray(monitors)) return null
  for (var i = 0; i < monitors.length; i++) {
    if (monitors[i].focused) return monitors[i]
  }
  return monitors.length ? monitors[0] : null
}

function monitorLogicalSize(monitor) {
  if (!monitor) return { width: 1920, height: 1080 }
  var scale = Number(monitor.scale) || 1
  if (scale <= 0) scale = 1
  var width = Math.round((Number(monitor.width) || 1920) / scale)
  var height = Math.round((Number(monitor.height) || 1080) / scale)
  return { width: width, height: height }
}

// Hyprland window addresses are hex (with or without 0x). Reject anything else.
function isValidAddress(address) {
  var raw = String(address || "").trim()
  return /^0x[0-9a-fA-F]+$/.test(raw) || /^[0-9a-fA-F]+$/.test(raw)
}

function normalizeAddress(address) {
  var raw = String(address || "").trim()
  if (!isValidAddress(raw)) return ""
  if (/^0x/i.test(raw)) return "0x" + raw.slice(2)
  return "0x" + raw
}

// Build a store record from an active client + monitors list.
function recordFromClient(client, monitors) {
  if (!client) return null
  var size = client.size || [0, 0]
  // Reuse a size-similar key when one exists so changing titles share a layout.
  var key = resolveSaveKey(null, client, size)
  if (!key) return null

  var at = client.at || [0, 0]
  var monitor = findMonitorById(monitors, client.monitor) || focusedMonitor(monitors)
  var monName = monitor ? String(monitor.name || "") : ""
  var monX = monitor ? Number(monitor.x) || 0 : 0
  var monY = monitor ? Number(monitor.y) || 0 : 0

  return {
    key: key,
    monitor: monName,
    x: Math.round((Number(at[0]) || 0) - monX),
    y: Math.round((Number(at[1]) || 0) - monY),
    w: Math.max(1, Math.round(Number(size[0]) || 0)),
    h: Math.max(1, Math.round(Number(size[1]) || 0)),
    pinned: !!client.pinned,
    updatedAt: Math.floor(Date.now() / 1000)
  }
}

// Like recordFromClient but can reuse size-similar keys from an existing store.
function recordFromClientInStore(store, client, monitors) {
  if (!client) return null
  var size = client.size || [0, 0]
  var key = resolveSaveKey(store, client, size)
  if (!key) return null
  var base = recordFromClient(client, monitors)
  if (!base) return null
  base.key = key
  return base
}

// Resolve a saved record into global pixel geometry, clamped to a monitor.
function resolvePlacement(record, monitors) {
  if (!record) return null
  var monitor = findMonitorByName(monitors, record.monitor) || focusedMonitor(monitors)
  if (!monitor) return null

  var logical = monitorLogicalSize(monitor)
  var monX = Number(monitor.x) || 0
  var monY = Number(monitor.y) || 0
  var w = Math.max(1, Math.min(Math.round(Number(record.w) || 1), logical.width))
  var h = Math.max(1, Math.min(Math.round(Number(record.h) || 1), logical.height))
  var relX = Math.round(Number(record.x) || 0)
  var relY = Math.round(Number(record.y) || 0)

  // Keep the window fully on-monitor when possible.
  if (relX + w > logical.width) relX = Math.max(0, logical.width - w)
  if (relY + h > logical.height) relY = Math.max(0, logical.height - h)
  if (relX < 0) relX = 0
  if (relY < 0) relY = 0

  return {
    monitor: String(monitor.name || ""),
    x: monX + relX,
    y: monY + relY,
    w: w,
    h: h,
    pinned: !!record.pinned
  }
}

function shellQuote(value) {
  return "'" + String(value || "").replace(/'/g, "'\\''") + "'"
}

function luaQuote(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function intPixel(value) {
  var n = Math.round(Number(value) || 0)
  if (!isFinite(n)) return 0
  return n
}

// Dual dispatch: prefer Omarchy Lua dispatcher, fall back to classic hyprctl.
// Address must be hex-only; placement values are coerced to integers.
function applyScript(address, placement, floating) {
  var addr = normalizeAddress(address)
  if (!addr || !placement) return ""

  var window = "address:" + addr
  var quoted = shellQuote(window)
  var luaWin = luaQuote(window)
  var x = intPixel(placement.x)
  var y = intPixel(placement.y)
  var w = Math.max(1, intPixel(placement.w))
  var h = Math.max(1, intPixel(placement.h))

  var lines = []
  if (!floating) {
    lines.push("hyprctl dispatch \"hl.dsp.window.float({ window = \\\"" + luaWin + "\\\", action = \\\"set\\\" })\" >/dev/null 2>&1 \\")
    lines.push("  || hyprctl dispatch setfloating " + quoted + " >/dev/null")
  }

  lines.push("hyprctl dispatch \"hl.dsp.window.resize({ window = \\\"" + luaWin + "\\\", x = " + w + ", y = " + h + " })\" >/dev/null 2>&1 \\")
  lines.push("  || hyprctl dispatch resizewindowpixel exact " + w + " " + h + "," + window + " >/dev/null")

  lines.push("hyprctl dispatch \"hl.dsp.window.move({ window = \\\"" + luaWin + "\\\", x = " + x + ", y = " + y + " })\" >/dev/null 2>&1 \\")
  lines.push("  || hyprctl dispatch movewindowpixel exact " + x + " " + y + "," + window + " >/dev/null")

  if (placement.pinned) {
    lines.push("hyprctl dispatch \"hl.dsp.window.pin({ window = \\\"" + luaWin + "\\\" })\" >/dev/null 2>&1 \\")
    lines.push("  || hyprctl dispatch pin " + quoted + " >/dev/null")
  }

  return lines.join("\n")
}

// Parse slurp output: "X,Y WxH" (also tolerates "%x %y %w %h").
function parseSlurpBox(text) {
  var raw = String(text || "").trim()
  if (!raw) return null

  var match = raw.match(/^(-?\d+)\s*,\s*(-?\d+)\s+(\d+)\s*x\s*(\d+)$/i)
  if (!match) {
    match = raw.match(/^(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)$/)
  }
  if (!match) return null

  var w = Math.round(Number(match[3]))
  var h = Math.round(Number(match[4]))
  if (w < 1 || h < 1) return null

  return {
    x: Math.round(Number(match[1])),
    y: Math.round(Number(match[2])),
    w: w,
    h: h
  }
}

function findMonitorAtPoint(monitors, x, y) {
  if (!Array.isArray(monitors)) return null
  for (var i = 0; i < monitors.length; i++) {
    var mon = monitors[i]
    var logical = monitorLogicalSize(mon)
    var left = Number(mon.x) || 0
    var top = Number(mon.y) || 0
    if (x >= left && y >= top && x < left + logical.width && y < top + logical.height)
      return mon
  }
  return focusedMonitor(monitors)
}

// Build a store record from a global pixel box (e.g. from slurp).
function recordFromBox(key, box, monitors, pinned) {
  var id = String(key || "").trim()
  if (!id || !box) return null

  var monitor = findMonitorAtPoint(monitors, box.x, box.y) || focusedMonitor(monitors)
  var monName = monitor ? String(monitor.name || "") : ""
  var monX = monitor ? Number(monitor.x) || 0 : 0
  var monY = monitor ? Number(monitor.y) || 0 : 0

  return {
    key: id,
    monitor: monName,
    x: Math.round(box.x - monX),
    y: Math.round(box.y - monY),
    w: Math.max(1, Math.round(box.w)),
    h: Math.max(1, Math.round(box.h)),
    pinned: !!pinned,
    updatedAt: Math.floor(Date.now() / 1000)
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    KEY_SEP: KEY_SEP,
    POPUP_MONITOR_RATIO: POPUP_MONITOR_RATIO,
    MAIN_MONITOR_RATIO: MAIN_MONITOR_RATIO,
    SIMILAR_AREA_RATIO: SIMILAR_AREA_RATIO,
    windowClass: windowClass,
    windowTitle: windowTitle,
    sanitizeTitle: sanitizeTitle,
    windowKey: windowKey,
    classOfKey: classOfKey,
    titleOfKey: titleOfKey,
    clientArea: clientArea,
    monitorArea: monitorArea,
    popupRole: popupRole,
    areasSimilar: areasSimilar,
    sizeCompatible: sizeCompatible,
    sizeCompatibleLoose: sizeCompatibleLoose,
    titleTokens: titleTokens,
    titleFuzzyScore: titleFuzzyScore,
    keysForClass: keysForClass,
    hasClassEntry: hasClassEntry,
    findSimilarLayout: findSimilarLayout,
    resolveSaveKey: resolveSaveKey,
    explainFindPosition: explainFindPosition,
    findPosition: findPosition,
    formatMatchExplain: formatMatchExplain,
    eventParts: eventParts,
    findMonitorByName: findMonitorByName,
    findMonitorById: findMonitorById,
    findMonitorAtPoint: findMonitorAtPoint,
    focusedMonitor: focusedMonitor,
    monitorLogicalSize: monitorLogicalSize,
    isValidAddress: isValidAddress,
    normalizeAddress: normalizeAddress,
    recordFromClient: recordFromClient,
    recordFromClientInStore: recordFromClientInStore,
    recordFromBox: recordFromBox,
    parseSlurpBox: parseSlurpBox,
    resolvePlacement: resolvePlacement,
    shellQuote: shellQuote,
    luaQuote: luaQuote,
    applyScript: applyScript
  }
}
