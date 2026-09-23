import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import "Store.js" as Store
import "Geometry.js" as Geometry

// Headless omafloat service: capture/commit/cancel IPC, openwindow restore.
Item {
  id: root

  property var shell: null
  property var pluginRegistry: null
  property var manifest: null

  readonly property string homeDir: Quickshell.env("HOME") || ""
  readonly property string stateDir: (Quickshell.env("XDG_STATE_HOME") || (homeDir + "/.local/state")) + "/omarchy/omafloat"
  readonly property string statePath: stateDir + "/positions.json"
  readonly property string pluginDir: {
    var url = Qt.resolvedUrl(".").toString()
    return url.indexOf("file://") === 0 ? url.slice("file://".length).replace(/\/$/, "") : url.replace(/\/$/, "")
  }
  readonly property string captureScript: pluginDir + "/scripts/capture-box.sh"

  property var store: Store.emptyStore()
  property bool stateReady: false
  property string lastEvent: ""
  property string capturePhase: "idle"
  property string pendingRestoreAddress: ""
  property string pendingRestoreClass: ""
  property string pendingRestoreTitle: ""
  property var matchLog: []
  readonly property int matchLogLimit: 40
  // address → { className, title, attempts } for delayed / title-change retries
  property var restoreQueue: ({})
  readonly property int maxRestoreAttempts: 3

  function notify(message) {
    if (notifyProc.running) return
    notifyProc.command = ["omarchy-notification-send", "-u", "low", "-g", "󰗡", "OmaFloat", String(message || "")]
    notifyProc.running = true
  }

  // Notification bodies use StyledText markup — strip angle brackets from app titles.
  function plainNotifyLabel(value) {
    return String(value || "").replace(/[<>]/g, "")
  }

  function runBash(script) {
    if (!script) return
    if (bashProc.running) {
      pendingBash = pendingBash ? (pendingBash + "\n" + script) : script
      return
    }
    bashProc.command = ["bash", "-c", script]
    bashProc.running = true
  }

  property string pendingBash: ""

  function persistStore() {
    ensureStateDir()
    stateFile.setText(Store.serializeStore(root.store))
  }

  function ensureStateDir(thenReload) {
    if (mkdirProc.running) {
      root.mkdirShouldReload = root.mkdirShouldReload || !!thenReload
      return
    }
    root.mkdirShouldReload = !!thenReload
    mkdirProc.command = ["mkdir", "-p", root.stateDir]
    mkdirProc.running = true
  }

  property bool mkdirShouldReload: false

  function reloadStore(raw) {
    root.store = Store.parseStore(raw)
    root.stateReady = true
  }

  function listJson() {
    return JSON.stringify(Store.listPositions(root.store))
  }

  function statusJson() {
    return JSON.stringify({
      ready: root.stateReady,
      path: root.statePath,
      count: Store.listPositions(root.store).length,
      capturePhase: root.capturePhase,
      lastEvent: root.lastEvent,
      matchLog: root.matchLog
    })
  }

  function matchLogJson() {
    return JSON.stringify(root.matchLog)
  }

  // Keep a short ring of restore decisions for debugging missed pop-ups.
  function pushMatchLog(explained, address, attempt) {
    var line = Geometry.formatMatchExplain(explained)
    var entry = {
      at: Math.floor(Date.now() / 1000),
      address: Geometry.normalizeAddress(address) || "",
      attempt: Number(attempt) || 0,
      line: line,
      result: explained && explained.match ? "restore" : "skip",
      reason: (explained && explained.reason) || "",
      className: (explained && explained.className) || "",
      title: (explained && explained.title) || "",
      role: (explained && explained.role) || "",
      live: (explained && explained.live) || {},
      matchedKey: explained && explained.match ? explained.match.key : "",
      candidates: (explained && explained.candidates) || []
    }
    var next = root.matchLog.slice()
    next.unshift(entry)
    if (next.length > root.matchLogLimit) next = next.slice(0, root.matchLogLimit)
    root.matchLog = next
    root.lastEvent = line
    console.log("omafloat:", line)
  }

  function forgetKey(key) {
    var id = String(key || "").trim()
    if (!id) {
      // Fall back to focused window class when no key is given.
      probeActiveForForget.running = true
      return "probing"
    }
    // Always start from disk so panel/script edits cannot leave a stale memory copy.
    syncStoreFromDisk()
    if (!Store.getPosition(root.store, id)) {
      root.lastEvent = "forget-missing:" + id
      notify("Nothing remembered for " + plainNotifyLabel(id))
      return "missing"
    }
    root.store = Store.forgetPosition(root.store, id)
    persistStore()
    root.lastEvent = "forget:" + id
    notify("Forgot " + plainNotifyLabel(id))
    return "ok"
  }

  function syncStoreFromDisk() {
    root.reloadStore(stateFile.text())
  }

  function commitActiveClient(clientText, monitorsText) {
    var client = null
    var monitors = []
    try { client = JSON.parse(clientText) } catch (e1) { return "no-window" }
    try { monitors = JSON.parse(monitorsText) } catch (e2) { monitors = [] }

    var record = Geometry.recordFromClientInStore(root.store, client, monitors)
    if (!record || !record.key) return "no-key"

    root.store = Store.upsertPosition(root.store, record.key, record)
    persistStore()
    root.capturePhase = "idle"
    notify("Saved safe layout for " + plainNotifyLabel(record.key))
    root.lastEvent = "commit:" + record.key
    return "ok"
  }

  function clearRestoreQueueEntry(address) {
    var addr = Geometry.normalizeAddress(address)
    if (!addr || !root.restoreQueue[addr]) return
    var next = ({})
    for (var key in root.restoreQueue) {
      if (key !== addr) next[key] = root.restoreQueue[key]
    }
    root.restoreQueue = next
  }

  function queueRestore(address, className, title, resetAttempts) {
    var cls = String(className || "").trim()
    var addr = Geometry.normalizeAddress(address)
    if (!cls || !addr) return
    if (!Geometry.hasClassEntry(root.store, cls)) return

    var prev = root.restoreQueue[addr]
    var attempts = (prev && !resetAttempts) ? (Number(prev.attempts) || 0) : 0
    var next = ({})
    for (var key in root.restoreQueue) next[key] = root.restoreQueue[key]
    next[addr] = {
      className: cls,
      title: Geometry.sanitizeTitle(title) || (prev && prev.title) || "",
      attempts: attempts
    }
    root.restoreQueue = next

    root.pendingRestoreAddress = addr
    root.pendingRestoreClass = cls
    root.pendingRestoreTitle = next[addr].title
    restoreTimer.interval = 120
    restoreTimer.restart()
  }

  function scheduleRestoreRetry(address) {
    var addr = Geometry.normalizeAddress(address)
    var meta = root.restoreQueue[addr]
    if (!meta) return
    if ((Number(meta.attempts) || 0) >= root.maxRestoreAttempts) {
      root.clearRestoreQueueEntry(addr)
      return
    }
    root.pendingRestoreAddress = addr
    root.pendingRestoreClass = meta.className
    root.pendingRestoreTitle = meta.title
    // Give wallets/mail time to map real size and settle their title.
    restoreTimer.interval = 350 * Math.max(1, Number(meta.attempts) || 1)
    restoreTimer.restart()
  }

  function bumpRestoreAttempt(address) {
    var addr = Geometry.normalizeAddress(address)
    var meta = root.restoreQueue[addr]
    if (!meta) return 0
    var next = ({})
    for (var key in root.restoreQueue) next[key] = root.restoreQueue[key]
    next[addr] = {
      className: meta.className,
      title: meta.title,
      attempts: (Number(meta.attempts) || 0) + 1
    }
    root.restoreQueue = next
    return next[addr].attempts
  }

  function runPendingRestore() {
    var address = root.pendingRestoreAddress
    var className = root.pendingRestoreClass
    var title = root.pendingRestoreTitle
    root.pendingRestoreAddress = ""
    root.pendingRestoreClass = ""
    root.pendingRestoreTitle = ""
    if (!address || !className || !Geometry.isValidAddress(address)) return

    // Address/class/title arrive as argv — never concatenate into the script body.
    restoreProbe.command = ["bash", "-c",
      'ADDR="$1"; CLASS="$2"; TITLE="$3"; ' +
      'CLIENT=$(hyprctl -j clients | jq -c --arg a "$ADDR" \'.[] | select(.address == $a or .address == ("0x"+$a) or (.address|tostring|ascii_downcase) == ($a|ascii_downcase))\'); ' +
      'MONS=$(hyprctl -j monitors); ' +
      'printf \"%s\\n---\\n%s\\n---\\n%s\\n---\\n%s\\n\" "$CLIENT" "$MONS" "$CLASS" "$TITLE"',
      "bash", address, className, title]
    restoreProbe.running = true
  }

  function applyParsedRestore(clientText, monitorsText, className, title) {
    var client = null
    var monitors = []
    try { client = JSON.parse(clientText) } catch (e1) { return }
    try { monitors = JSON.parse(monitorsText) } catch (e2) { return }
    if (!client || !Geometry.isValidAddress(client.address)) return

    var addr = Geometry.normalizeAddress(client.address)
    syncStoreFromDisk()
    var cls = String(className || Geometry.windowClass(client) || "").trim()
    var wantTitle = Geometry.sanitizeTitle(title) || Geometry.windowTitle(client)
    // Keep the latest live title on the retry queue.
    if (root.restoreQueue[addr]) {
      var queued = ({})
      for (var key in root.restoreQueue) queued[key] = root.restoreQueue[key]
      queued[addr] = {
        className: cls || queued[addr].className,
        title: wantTitle || queued[addr].title,
        attempts: queued[addr].attempts
      }
      root.restoreQueue = queued
    }

    var mon = Geometry.findMonitorById(monitors, client.monitor) || Geometry.focusedMonitor(monitors)
    var monSize = Geometry.monitorLogicalSize(mon)
    var explained = Geometry.explainFindPosition(root.store, cls, wantTitle, client.size, monSize)
    var meta = root.restoreQueue[addr]
    var attempt = meta ? (Number(meta.attempts) || 0) : 0
    root.pushMatchLog(explained, addr, attempt)

    var match = explained.match
    if (!match || !match.record) {
      var attempts = root.bumpRestoreAttempt(addr)
      if (attempts > 0 && attempts < root.maxRestoreAttempts)
        root.scheduleRestoreRetry(addr)
      else
        root.clearRestoreQueueEntry(addr)
      return
    }
    var placement = Geometry.resolvePlacement(match.record, monitors)
    if (!placement) {
      root.clearRestoreQueueEntry(addr)
      return
    }

    var script = Geometry.applyScript(client.address, placement, !!client.floating)
    if (!script) {
      root.clearRestoreQueueEntry(addr)
      return
    }
    runBash(script)
    root.clearRestoreQueueEntry(addr)
  }

  function handleHyprlandEvent(event) {
    var name = String(event && event.name ? event.name : "")
    if (name === "openwindow") {
      var parts = Geometry.eventParts(event, 4)
      var address = Geometry.normalizeAddress(parts[0] || "")
      var className = String(parts[2] || "")
      var title = String(parts[3] || "")
      if (!address || !className) return
      // Re-read disk before restore so panel/script forgets are never skipped.
      syncStoreFromDisk()
      root.queueRestore(address, className, title, true)
      return
    }
    // Titles often settle after open (wallets, mail) — retry while still queued.
    if (name === "windowtitle") {
      var titleParts = Geometry.eventParts(event, 2)
      var titleAddr = Geometry.normalizeAddress(titleParts[0] || "")
      var newTitle = String(titleParts[1] || "")
      if (!titleAddr || !root.restoreQueue[titleAddr]) return
      var meta = root.restoreQueue[titleAddr]
      root.queueRestore(titleAddr, meta.className, newTitle || meta.title, false)
    }
  }

  function startCapture() {
    // Second press cancels an in-flight picker.
    if (root.capturePhase === "draw" || captureProc.running) {
      return cancelCapture()
    }
    root.capturePhase = "draw"
    captureProc.command = [root.captureScript]
    captureProc.running = true
    return "ok"
  }

  function cancelCapture() {
    root.capturePhase = "idle"
    if (captureProc.running) captureProc.running = false
    runBash("pkill -x slurp >/dev/null 2>&1 || true")
    notify("Capture cancelled")
    root.lastEvent = "cancel"
    return "ok"
  }

  function startCommit() {
    commitProbe.running = true
    return "ok"
  }

  Process {
    id: mkdirProc
    onExited: function() {
      if (root.mkdirShouldReload) {
        root.mkdirShouldReload = false
        stateFile.reload()
      }
    }
  }

  Process {
    id: notifyProc
  }

  Process {
    id: bashProc
    onExited: function() {
      if (root.pendingBash) {
        var next = root.pendingBash
        root.pendingBash = ""
        root.runBash(next)
      }
    }
  }

  // Standalone script: notify → slurp box → float/move/resize → save JSON.
  Process {
    id: captureProc
    stdout: StdioCollector {
      id: captureOut
      waitForEnd: true
    }
    stderr: StdioCollector {
      id: captureErr
      waitForEnd: true
    }
    onExited: function(exitCode) {
      root.capturePhase = "idle"
      if (exitCode === 0) {
        root.lastEvent = "commit-box"
        // FileView watch reloads the store; nudge in case the write raced.
        Qt.callLater(function() { stateFile.reload() })
        return
      }
      root.lastEvent = "capture-failed:" + exitCode
      if (String(captureErr.text || "").trim().length)
        console.warn("omafloat capture:", captureErr.text)
    }
  }

  Process {
    id: commitProbe
    command: ["bash", "-c", "hyprctl -j activewindow; echo '---'; hyprctl -j monitors"]
    stdout: StdioCollector {
      id: commitOut
      waitForEnd: true
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        root.capturePhase = "idle"
        root.notify("Could not read window geometry")
        return
      }
      var chunks = String(commitOut.text || "").split("\n---\n")
      var result = root.commitActiveClient(chunks[0] || "", chunks[1] || "")
      if (result !== "ok") {
        root.capturePhase = "idle"
        root.notify("Could not save layout")
      }
    }
  }

  Process {
    id: probeActiveForForget
    command: ["bash", "-c", "hyprctl -j activewindow"]
    stdout: StdioCollector {
      id: forgetOut
      waitForEnd: true
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) return
      try {
        var client = JSON.parse(forgetOut.text)
        var key = Geometry.windowKey(client)
        if (key) root.forgetKey(key)
      } catch (error) {
      }
    }
  }

  Process {
    id: restoreProbe
    stdout: StdioCollector {
      id: restoreOut
      waitForEnd: true
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) return
      var chunks = String(restoreOut.text || "").split("\n---\n")
      root.applyParsedRestore(
        chunks[0] || "",
        chunks[1] || "",
        String(chunks[2] || "").trim(),
        String(chunks[3] || "").trim()
      )
    }
  }

  Timer {
    id: restoreTimer
    // First pass is quick; retries stretch the interval in scheduleRestoreRetry.
    interval: 120
    repeat: false
    onTriggered: root.runPendingRestore()
  }

  FileView {
    id: stateFile
    path: root.statePath
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: root.reloadStore(text())
    onLoadFailed: {
      // First run: create an empty store so later writes and the bar panel work.
      root.reloadStore("{}")
      root.persistStore()
    }
    onFileChanged: reload()
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) { root.handleHyprlandEvent(event) }
  }

  Component.onCompleted: {
    // Create the state directory first; reload the store once mkdir finishes.
    ensureStateDir(true)
  }

  IpcHandler {
    target: "agileautomation.omafloat"

    function capture(): string {
      return root.startCapture()
    }

    function commit(): string {
      return root.startCommit()
    }

    function cancel(): string {
      return root.cancelCapture()
    }

    function forget(): string {
      return root.forgetKey("")
    }

    function forgetKey(key: string): string {
      return root.forgetKey(key)
    }

    function list(): string {
      return root.listJson()
    }

    function status(): string {
      return root.statusJson()
    }

    function matchLog(): string {
      return root.matchLogJson()
    }
  }
}
