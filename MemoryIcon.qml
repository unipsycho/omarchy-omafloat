import QtQuick

// Full-size window frame with a light-bulb “memory” mark inside.
// Window chrome uses the theme color; the bulb is 50% yellow + 50% theme.
Item {
  id: root
  property color color: "#ffffff"
  property color bulbYellow: "#F5D76E"

  readonly property real s: Math.min(width, height)
  readonly property real stroke: Math.max(1, Math.round(root.s * 0.08))
  readonly property color bulbColor: Qt.rgba(
    (root.color.r + root.bulbYellow.r) * 0.5,
    (root.color.g + root.bulbYellow.g) * 0.5,
    (root.color.b + root.bulbYellow.b) * 0.5,
    1
  )

  // Window fills the icon slot
  Rectangle {
    id: win
    anchors.fill: parent
    anchors.margins: Math.max(0.5, root.s * 0.02)
    radius: Math.max(1, Math.round(root.s * 0.12))
    color: "transparent"
    border.color: root.color
    border.width: root.stroke

    // Title bar
    Rectangle {
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.top: parent.top
      anchors.leftMargin: root.stroke
      anchors.rightMargin: root.stroke
      anchors.topMargin: parent.height * 0.22
      height: Math.max(1, Math.round(root.s * 0.07))
      color: root.color
    }

    // Light bulb body
    Item {
      id: bulb
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.verticalCenter: parent.verticalCenter
      anchors.verticalCenterOffset: parent.height * 0.08
      width: parent.width * 0.42
      height: parent.height * 0.52

      // Glass
      Rectangle {
        id: glass
        width: parent.width
        height: parent.width
        radius: width / 2
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        color: Qt.rgba(root.bulbColor.r, root.bulbColor.g, root.bulbColor.b, 0.18)
        border.color: root.bulbColor
        border.width: Math.max(1, Math.round(root.s * 0.07))
      }

      // Filament hint
      Rectangle {
        width: Math.max(1, glass.width * 0.08)
        height: glass.height * 0.28
        radius: width / 2
        color: root.bulbColor
        anchors.horizontalCenter: glass.horizontalCenter
        anchors.verticalCenter: glass.verticalCenter
        opacity: 0.95
      }

      // Screw base
      Rectangle {
        width: glass.width * 0.45
        height: parent.height * 0.18
        radius: Math.max(1, width * 0.15)
        color: root.bulbColor
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: glass.bottom
        anchors.topMargin: -root.s * 0.02
      }

      // Base lip
      Rectangle {
        width: glass.width * 0.32
        height: Math.max(1.5, root.s * 0.06)
        radius: height / 2
        color: root.bulbColor
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
      }
    }
  }
}
