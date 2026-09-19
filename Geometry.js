// Window/monitor geometry helpers for omafloat.

var KEY_SEP = "::"
// Reject restore when the live window is clearly larger than the saved popup.
var SIZE_DIM_RATIO = 1.8
var SIZE_AREA_RATIO = 2.5

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
  text = text.replace(/\s+/g, " ").trim()
  if (!text) return ""
  if (text.length > 120) text = text.slice(0, 120)
  return text
}

function windowTitle(client) {
  if (!client || typeof client !== "object") return ""
  var initial = sanitizeTitle(client.initialTitle)
  if (initial) return initial
  return sanitizeTitle(client.title)
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

// True when the live window is still in the same "popup" size class as the save.
function sizeCompatible(record, clientSize) {
  if (!record) return false
  var rw = Math.max(1, Math.round(Number(record.w) || 0))
  var rh = Math.max(1, Math.round(Number(record.h) || 0))
  if (!clientSize) return true
  var cw = Math.max(0, Math.round(Number(clientSize[0] || clientSize.w) || 0))
  var ch = Math.max(0, Math.round(Number(clientSize[1] || clientSize.h) || 0))
  // Unknown size yet — allow and let a later probe decide.
  if (cw < 1 || ch < 1) return true
  if (cw > rw * SIZE_DIM_RATIO && ch > rh * SIZE_DIM_RATIO) return false
  if (cw * ch > rw * rh * SIZE_AREA_RATIO) return false
  return true
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

// Resolve the best remembered layout for an opening window.
// Priority: exact class::title → bare class (legacy) → closest size-compatible sibling.
function findPosition(store, className, title, clientSize) {
  var cls = String(className || "").trim()
  if (!cls || !store || !store.positions) return null

  var wantTitle = sanitizeTitle(title)
  var exactKey = wantTitle ? (cls + KEY_SEP + wantTitle) : ""
  if (exactKey && store.positions[exactKey] && sizeCompatible(store.positions[exactKey], clientSize)) {
    return { key: exactKey, record: store.positions[exactKey] }
  }

  if (store.positions[cls] && sizeCompatible(store.positions[cls], clientSize)) {
    return { key: cls, record: store.positions[cls] }
  }

  var candidates = keysForClass(store, cls)
  var best = null
  var bestDelta = Infinity
  var liveArea = clientArea(clientSize)
  for (var i = 0; i < candidates.length; i++) {
    var row = candidates[i]
    if (!sizeCompatible(row.record, clientSize)) continue
    // Prefer titled siblings over unrelated bare matches already handled above.
    if (row.key === cls) continue
    var savedArea = Math.max(1, Math.round(Number(row.record.w) || 0) * Math.round(Number(row.record.h) || 0))
    // Prefer closest area; if size is unknown yet, prefer the newest sibling.
    var delta = liveArea > 0
      ? Math.abs(savedArea - liveArea)
      : (1e15 - (Number(row.record.updatedAt) || 0))
    if (!best || delta < bestDelta) {
      best = row
      bestDelta = delta
    }
  }
  return best
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
  var key = windowKey(client)
  if (!key) return null

  var at = client.at || [0, 0]
  var size = client.size || [0, 0]
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
    windowClass: windowClass,
    windowTitle: windowTitle,
    sanitizeTitle: sanitizeTitle,
    windowKey: windowKey,
    classOfKey: classOfKey,
    titleOfKey: titleOfKey,
    sizeCompatible: sizeCompatible,
    keysForClass: keysForClass,
    hasClassEntry: hasClassEntry,
    findPosition: findPosition,
    eventParts: eventParts,
    findMonitorByName: findMonitorByName,
    findMonitorById: findMonitorById,
    findMonitorAtPoint: findMonitorAtPoint,
    focusedMonitor: focusedMonitor,
    monitorLogicalSize: monitorLogicalSize,
    isValidAddress: isValidAddress,
    normalizeAddress: normalizeAddress,
    recordFromClient: recordFromClient,
    recordFromBox: recordFromBox,
    parseSlurpBox: parseSlurpBox,
    resolvePlacement: resolvePlacement,
    shellQuote: shellQuote,
    luaQuote: luaQuote,
    applyScript: applyScript
  }
}
