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

  function notify(message) {
    if (notifyProc.running) return
    notifyProc.command = ["omarchy-notification-send", "-u", "low", "-g", "󰗡", "OmaFloat", String(message || "")]
    notifyProc.running = true
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
      lastEvent: root.lastEvent
    })
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
      notify("Nothing remembered for " + id)
      return "missing"
    }
    root.store = Store.forgetPosition(root.store, id)
    persistStore()
    root.lastEvent = "forget:" + id
    notify("Forgot " + id)
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

    var record = Geometry.recordFromClient(client, monitors)
    if (!record || !record.key) return "no-key"

    root.store = Store.upsertPosition(root.store, record.key, record)
    persistStore()
    root.capturePhase = "idle"
    notify("Saved safe layout for " + record.key)
    root.lastEvent = "commit:" + record.key
    return "ok"
  }

  function restoreAddress(address, className) {
    var key = String(className || "").trim()
    var addr = Geometry.normalizeAddress(address)
    var record = Store.getPosition(root.store, key)
    if (!record || !addr) return
    root.pendingRestoreAddress = addr
    root.pendingRestoreClass = key
    restoreTimer.restart()
  }

  function runPendingRestore() {
    var address = root.pendingRestoreAddress
    var key = root.pendingRestoreClass
    root.pendingRestoreAddress = ""
    root.pendingRestoreClass = ""
    if (!address || !key || !Geometry.isValidAddress(address)) return

    var record = Store.getPosition(root.store, key)
    if (!record) return

    // Address/key arrive as argv ($1/$2) — never concatenate into the script body.
    restoreProbe.command = ["bash", "-c",
      'ADDR="$1"; KEY="$2"; ' +
      'CLIENT=$(hyprctl -j clients | jq -c --arg a "$ADDR" \'.[] | select(.address == $a or .address == ("0x"+$a) or (.address|tostring|ascii_downcase) == ($a|ascii_downcase))\'); ' +
      'MONS=$(hyprctl -j monitors); ' +
      'printf \"%s\\n---\\n%s\\n---\\n%s\\n\" "$CLIENT" "$MONS" "$KEY"',
      "bash", address, key]
    restoreProbe.running = true
  }

  function applyParsedRestore(clientText, monitorsText, key) {
    var client = null
    var monitors = []
    try { client = JSON.parse(clientText) } catch (e1) { return }
    try { monitors = JSON.parse(monitorsText) } catch (e2) { return }
    if (!client || !Geometry.isValidAddress(client.address)) return

    syncStoreFromDisk()
    var record = Store.getPosition(root.store, key)
      || Store.getPosition(root.store, Geometry.windowKey(client))
      || Store.getPosition(root.store, String(client.class || ""))
    if (!record) {
      root.lastEvent = "restore-skipped:" + (key || Geometry.windowKey(client))
      return
    }
    var placement = Geometry.resolvePlacement(record, monitors)
    if (!placement) return

    var script = Geometry.applyScript(client.address, placement, !!client.floating)
    if (!script) return
    runBash(script)
    root.lastEvent = "restore:" + (key || Geometry.windowKey(client))
  }

  function handleHyprlandEvent(event) {
    var name = String(event && event.name ? event.name : "")
    if (name !== "openwindow") return
    var parts = Geometry.eventParts(event, 4)
    var address = Geometry.normalizeAddress(parts[0] || "")
    var className = String(parts[2] || "")
    if (!address || !className) return
    // Re-read disk before restore so panel/script forgets are never skipped.
    syncStoreFromDisk()
    if (!Store.getPosition(root.store, className)) return
    restoreAddress(address, className)
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
      root.applyParsedRestore(chunks[0] || "", chunks[1] || "", String(chunks[2] || "").trim())
    }
  }

  Timer {
    id: restoreTimer
    interval: 80
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
  }
}
