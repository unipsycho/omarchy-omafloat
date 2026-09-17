// Pure helpers for omafloat positions.json — no Quickshell imports.

function emptyStore() {
  return { version: 1, positions: {} }
}

function parseStore(raw) {
  var text = String(raw || "").trim()
  if (!text) return emptyStore()
  try {
    var parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object") return emptyStore()
    if (!parsed.positions || typeof parsed.positions !== "object") parsed.positions = {}
    if (!parsed.version) parsed.version = 1
    return parsed
  } catch (error) {
    return emptyStore()
  }
}

function serializeStore(store) {
  var payload = store && typeof store === "object" ? store : emptyStore()
  if (!payload.positions || typeof payload.positions !== "object") payload.positions = {}
  payload.version = payload.version || 1
  return JSON.stringify(payload, null, 2) + "\n"
}

function upsertPosition(store, key, record) {
  var next = parseStore(serializeStore(store))
  var id = String(key || "").trim()
  if (!id || !record) return next
  next.positions[id] = {
    monitor: String(record.monitor || ""),
    x: Math.round(Number(record.x) || 0),
    y: Math.round(Number(record.y) || 0),
    w: Math.max(1, Math.round(Number(record.w) || 0)),
    h: Math.max(1, Math.round(Number(record.h) || 0)),
    pinned: !!record.pinned,
    updatedAt: Number(record.updatedAt) || Math.floor(Date.now() / 1000)
  }
  return next
}

function forgetPosition(store, key) {
  var next = parseStore(serializeStore(store))
  var id = String(key || "").trim()
  if (id && next.positions[id] !== undefined) delete next.positions[id]
  return next
}

function getPosition(store, key) {
  var id = String(key || "").trim()
  if (!id || !store || !store.positions) return null
  var record = store.positions[id]
  return record && typeof record === "object" ? record : null
}

function listPositions(store) {
  var rows = []
  var positions = store && store.positions ? store.positions : {}
  for (var key in positions) {
    var record = positions[key]
    if (!record || typeof record !== "object") continue
    rows.push({
      key: key,
      monitor: String(record.monitor || ""),
      x: Math.round(Number(record.x) || 0),
      y: Math.round(Number(record.y) || 0),
      w: Math.max(1, Math.round(Number(record.w) || 0)),
      h: Math.max(1, Math.round(Number(record.h) || 0)),
      pinned: !!record.pinned,
      updatedAt: Number(record.updatedAt) || 0
    })
  }
  rows.sort(function(a, b) {
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
    return String(a.key).localeCompare(String(b.key))
  })
  return rows
}

if (typeof module !== "undefined") {
  module.exports = {
    emptyStore: emptyStore,
    parseStore: parseStore,
    serializeStore: serializeStore,
    upsertPosition: upsertPosition,
    forgetPosition: forgetPosition,
    getPosition: getPosition,
    listPositions: listPositions
  }
}
