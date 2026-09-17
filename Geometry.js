// Window/monitor geometry helpers for omafloat.

function windowKey(client) {
  if (!client || typeof client !== "object") return ""
  var initial = String(client.initialClass || "").trim()
  if (initial) return initial
  return String(client.class || "").trim()
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
    windowKey: windowKey,
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
