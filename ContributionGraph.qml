import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model

// GitHub-style year of finished work sessions: week columns of day
// squares, month names above, every other weekday beside, and a
// less → more legend. Renders Model.contributionGrid output as is.
Column {
  id: root

  property var grid: ({ weeks: [], monthLabels: [], dayLabels: [] })
  property color foreground: Color.foreground
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  readonly property int cell: Style.space(11)
  readonly property int gap: Style.space(3)
  readonly property int dayLabelWidth: Style.space(28)
  readonly property int gridWidth: dayLabelWidth + grid.weeks.length * (cell + gap)
  readonly property color mutedForeground: Qt.darker(foreground, 1.5)

  function cellColor(level) {
    if (level <= 0) return Qt.rgba(foreground.r, foreground.g, foreground.b, 0.08)
    return Qt.rgba(accent.r, accent.g, accent.b, [0.3, 0.5, 0.75, 1][level - 1])
  }

  spacing: Style.space(4)

  Item {
    width: root.gridWidth
    height: Style.font.caption + Style.space(4)

    Repeater {
      model: root.grid.monthLabels

      Text {
        required property var modelData
        x: root.dayLabelWidth + modelData.column * (root.cell + root.gap)
        textFormat: Text.PlainText
        text: modelData.label
        color: root.mutedForeground
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }

  Row {
    spacing: root.gap

    Column {
      width: root.dayLabelWidth - root.gap
      spacing: root.gap

      Repeater {
        model: root.grid.dayLabels

        Text {
          required property var modelData
          height: root.cell
          verticalAlignment: Text.AlignVCenter
          textFormat: Text.PlainText
          text: modelData
          color: root.mutedForeground
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }

    Repeater {
      model: root.grid.weeks

      Column {
        id: week
        required property var modelData
        spacing: root.gap

        Repeater {
          model: week.modelData

          Rectangle {
            id: day
            required property var modelData
            width: root.cell
            height: root.cell
            radius: Style.space(2)
            color: day.modelData.future ? "transparent" : root.cellColor(day.modelData.level)
            border.width: day.modelData.today ? Math.max(1, Style.space(1)) : 0
            border.color: root.foreground

            MouseArea {
              id: dayMouse
              anchors.fill: parent
              hoverEnabled: !day.modelData.future
            }

            PanelToolTip {
              visible: dayMouse.containsMouse
              text: Model.dayTooltip(day.modelData)
              fontFamily: root.fontFamily
            }
          }
        }
      }
    }
  }

  // ---- Legend, right-aligned under the grid.
  Item {
    width: root.gridWidth
    height: legend.implicitHeight

    Row {
      id: legend
      anchors.right: parent.right
      anchors.rightMargin: root.gap
      spacing: root.gap

      Text {
        anchors.verticalCenter: parent.verticalCenter
        rightPadding: Style.space(4)
        textFormat: Text.PlainText
        text: "less"
        color: root.mutedForeground
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }

      Repeater {
        model: 5

        Rectangle {
          required property int index
          width: root.cell
          height: root.cell
          radius: Style.space(2)
          color: root.cellColor(index)
        }
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        leftPadding: Style.space(4)
        textFormat: Text.PlainText
        text: "more"
        color: root.mutedForeground
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }
}
