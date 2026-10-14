import QtQuick
import qs.Commons
import qs.Ui

// A panel section whose header folds its content away. The shell has no
// collapsible component, so this pairs its PanelSeparator and
// PanelSectionHeader with a chevron. Always starts collapsed: the state is
// per popup instance and never persisted.
Column {
  id: root

  property string title: ""
  property bool expanded: false
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family

  default property alias content: body.data

  width: parent ? parent.width : implicitWidth
  spacing: Style.space(8)

  PanelSeparator { foreground: root.foreground }

  Item {
    width: parent.width
    height: Math.max(header.implicitHeight, chevron.implicitHeight) + Style.space(4)

    PanelSectionHeader {
      id: header
      anchors.verticalCenter: parent.verticalCenter
      text: root.title
      foreground: headerMouse.containsMouse ? Style.hoverStateColor(root.foreground, Color.accent) : root.foreground
      fontFamily: root.fontFamily
    }

    Text {
      id: chevron
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      text: "\u{F0142}"  // chevron-right, turned down when open
      rotation: root.expanded ? 90 : 0
      color: Qt.darker(root.foreground, 1.4)
      font.family: root.fontFamily
      font.pixelSize: Style.font.body

      Behavior on rotation { NumberAnimation { duration: 120; easing.type: Easing.OutCubic } }
    }

    MouseArea {
      id: headerMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: root.expanded = !root.expanded
    }
  }

  Column {
    id: body
    width: parent.width
    spacing: Style.space(8)
    visible: root.expanded
  }
}
