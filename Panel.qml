import QtQuick
import QtQuick.Layouts
import QtQuick.Effects
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Store.js" as Store

// List every saved safe layout; delete icon forgets one entry.
Panel {
  id: root
  moduleName: "agileautomation.omafloat"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  readonly property string homeDir: Quickshell.env("HOME") || ""
  readonly property string statePath: (Quickshell.env("XDG_STATE_HOME") || (homeDir + "/.local/state")) + "/omarchy/omafloat/positions.json"

  property var rows: []
  property var iconCache: ({})
  property string pendingForgetKey: ""

  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  // Keep in sync with bindings-snippet.lua / user bindings.lua
  readonly property string captureHotkey: "Super+Alt+O"

  function open() {
    reloadRows()
    root.controller.show()
  }

  function close() {
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) close()
    else open()
  }

  function closeForPopoutSwitch() {
    if (typeof root.controller.closeForPopoutSwitch === "function")
      root.controller.closeForPopoutSwitch()
    else
      close()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.hostWidget || root, direction)
    return false
  }

  function reloadRows() {
    stateFile.reload()
    root.rows = Store.listPositions(Store.parseStore(stateFile.text()))
  }

  // Forget through the keep-loaded service so restore cannot use a stale in-memory copy.
  function forgetRow(key) {
    var id = String(key || "")
    if (!id) return
    if (forgetProc.running) return
    root.pendingForgetKey = id
    // Optimistic UI remove
    root.rows = Store.listPositions(Store.forgetPosition(Store.parseStore(stateFile.text()), id))
    forgetProc.command = ["omarchy-shell", "agileautomation.omafloat", "forgetKey", id]
    forgetProc.running = true
  }

  Process {
    id: forgetProc
    stdout: StdioCollector { waitForEnd: true }
    stderr: StdioCollector { waitForEnd: true }
    onExited: function(exitCode) {
      root.pendingForgetKey = ""
      // Re-sync list from disk after the service owns the write.
      Qt.callLater(root.reloadRows)
    }
  }

  function summaryFor(row) {
    return String(row.monitor || "?") + "  " + row.w + "×" + row.h + "  @" + row.x + "," + row.y
  }

  function classOfKey(key) {
    var id = String(key || "")
    var idx = id.indexOf("::")
    return idx === -1 ? id : id.slice(0, idx)
  }

  function titleOfKey(key) {
    var id = String(key || "")
    var idx = id.indexOf("::")
    return idx === -1 ? "" : id.slice(idx + 2)
  }

  // Drop angle brackets so app-controlled titles cannot feed rich-text sinks.
  function plainLabel(value) {
    return String(value || "").replace(/[<>]/g, "")
  }

  function displayNameFor(key) {
    var cls = classOfKey(key)
    var title = titleOfKey(key)
    var entry = desktopEntryFor(cls)
    var appName = entry && entry.name ? String(entry.name) : (cls || String(key || ""))
    if (title) return plainLabel(appName + " — " + title)
    return plainLabel(appName)
  }

  function desktopEntryFor(key) {
    var id = classOfKey(key).trim()
    if (!id) return null
    try {
      return DesktopEntries.byId(id) || DesktopEntries.heuristicLookup(id)
    } catch (error) {
      return null
    }
  }

  function resolveIconName(name) {
    var value = String(name || "").trim()
    if (!value) return ""
    if (value.indexOf("file://") === 0 || value.indexOf("image://") === 0) return value
    if (value.charAt(0) === "/") return "file://" + value

    var shell = root.bar && root.bar.shell ? root.bar.shell : null
    var library = shell && shell.appLibrary ? shell.appLibrary : null
    if (library && typeof library.iconSource === "function") {
      var fromLibrary = String(library.iconSource(value) || "")
      var executable = String(Quickshell.iconPath("application-x-executable", true) || "")
      if (fromLibrary.length > 0 && fromLibrary !== executable) return fromLibrary
    }

    var themed = String(Quickshell.iconPath(value, true) || "")
    return themed
  }

  function iconFor(key) {
    var id = classOfKey(key).trim()
    if (!id) return Quickshell.iconPath("application-x-executable", true)

    var cacheKey = id.toLowerCase()
    if (root.iconCache[cacheKey]) return root.iconCache[cacheKey]

    var source = ""
    var entry = desktopEntryFor(id)
    if (entry && entry.icon) source = resolveIconName(entry.icon)
    if (!source) source = resolveIconName(id)

    // Last-ditch: try the trailing desktop-id segment (brave-browser → browser-ish misses; org.kde.dolphin → dolphin).
    if (!source && id.indexOf(".") !== -1) {
      var parts = id.split(".")
      source = resolveIconName(parts[parts.length - 1])
    }

    if (!source) source = Quickshell.iconPath("application-x-executable", true)

    var next = ({})
    for (var existing in root.iconCache) next[existing] = root.iconCache[existing]
    next[cacheKey] = source
    root.iconCache = next
    return source
  }

  FileView {
    id: stateFile
    path: root.statePath
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: if (root.opened) root.reloadRows()
    onFileChanged: reload()
    onLoadFailed: root.rows = []
  }

  onOpenedChanged: if (opened) reloadRows()

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.hostWidget || root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(Math.min(Style.space(420), contentColumn.implicitHeight + Style.space(24)))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: contentColumn
        width: parent.width
        spacing: Style.space(10)

        Text {
          width: parent.width
          text: "OmaFloat Memory"
          color: root.contentForeground
          font.family: root.contentFontFamily
          font.pixelSize: Style.font.subtitle
          font.bold: true
        }

        Text {
          width: parent.width
          text: "Pop-ups that stay put."
          color: root.contentForeground
          opacity: 0.75
          font.family: root.contentFontFamily
          font.pixelSize: Style.font.body
          wrapMode: Text.WordWrap
        }

        Item {
          width: parent.width
          height: Style.space(10)
        }

        RowLayout {
          width: parent.width
          spacing: Style.space(8)

          Text {
            Layout.fillWidth: true
            text: "Remembered windows"
            elide: Text.ElideRight
            color: root.contentForeground
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            opacity: 0.9
          }

          Text {
            text: root.captureHotkey
            color: root.contentForeground
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            opacity: 0.65
            horizontalAlignment: Text.AlignRight
          }
        }

        Text {
          width: parent.width
          visible: root.rows.length === 0
          text: "Nothing remembered yet — press " + root.captureHotkey + " and draw a box."
          color: root.contentForeground
          opacity: 0.7
          font.family: root.contentFontFamily
          font.pixelSize: Style.font.body
          wrapMode: Text.WordWrap
        }

        Repeater {
          model: root.rows

          delegate: RowLayout {
            width: contentColumn.width
            spacing: Style.space(8)

            Item {
              Layout.preferredWidth: Style.space(22)
              Layout.preferredHeight: Style.space(22)

              // Keep the source image as a hidden layer for MultiEffect.
              Image {
                id: appIcon
                anchors.fill: parent
                source: root.iconFor(modelData.key)
                fillMode: Image.PreserveAspectFit
                asynchronous: true
                smooth: true
                visible: false
                layer.enabled: true
                sourceSize.width: Math.round(width * Screen.devicePixelRatio)
                sourceSize.height: Math.round(height * Screen.devicePixelRatio)
                onStatusChanged: {
                  if (status === Image.Error)
                    source = Quickshell.iconPath("application-x-executable", true)
                }
              }

              // 50% original icon color, 50% theme foreground.
              MultiEffect {
                anchors.fill: appIcon
                source: appIcon
                colorization: 0.5
                colorizationColor: root.contentForeground
              }
            }

            Column {
              Layout.fillWidth: true
              spacing: Style.space(2)

              Text {
                width: parent.width
                // Window titles are app-controlled — never AutoText/rich text.
                textFormat: Text.PlainText
                text: root.displayNameFor(modelData.key)
                elide: Text.ElideRight
                color: root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                font.bold: true
              }

              Text {
                width: parent.width
                textFormat: Text.PlainText
                text: root.summaryFor(modelData)
                elide: Text.ElideRight
                color: root.contentForeground
                opacity: 0.7
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
              }
            }

            BarIconButton {
              Layout.preferredWidth: Style.bar.iconSlot
              Layout.preferredHeight: Style.bar.iconSlot
              bar: root.bar
              text: "󰧧"
              // Tooltip path uses PanelToolTip PlainText; still strip markup from the key.
              tooltipText: "Forget " + root.plainLabel(modelData.key)
              slotSize: Style.bar.iconSlot
              fontSize: Style.font.caption
              onPressed: function(buttonCode) {
                if (buttonCode === Qt.LeftButton) root.forgetRow(modelData.key)
              }
            }
          }
        }
      }
    }
  }
}
