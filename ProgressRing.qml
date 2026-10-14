import QtQuick
import QtQuick.Shapes

// Circular progress: a faint full track with the elapsed share drawn over it
// clockwise from twelve o'clock. Content placed inside sits in the middle.
Item {
  id: root

  property real progress: 0
  property color color: "white"
  property color trackColor: Qt.rgba(color.r, color.g, color.b, 0.15)
  property real thickness: 8

  default property alias content: inner.data

  readonly property real radius: (Math.min(width, height) - thickness) / 2

  implicitWidth: 180
  implicitHeight: 180

  // The 500 ms service tick would otherwise step the arc visibly.
  Behavior on progress { NumberAnimation { duration: 450; easing.type: Easing.OutCubic } }

  Shape {
    anchors.fill: parent
    preferredRendererType: Shape.CurveRenderer

    ShapePath {
      strokeColor: root.trackColor
      strokeWidth: root.thickness
      fillColor: "transparent"
      capStyle: ShapePath.RoundCap

      PathAngleArc {
        centerX: root.width / 2
        centerY: root.height / 2
        radiusX: root.radius
        radiusY: root.radius
        startAngle: -90
        sweepAngle: 360
      }
    }

    ShapePath {
      // A round cap paints a dot even at zero sweep; an empty ring is empty.
      strokeColor: root.progress > 0.001 ? root.color : "transparent"
      strokeWidth: root.thickness
      fillColor: "transparent"
      capStyle: ShapePath.RoundCap

      PathAngleArc {
        centerX: root.width / 2
        centerY: root.height / 2
        radiusX: root.radius
        radiusY: root.radius
        startAngle: -90
        sweepAngle: 360 * Math.min(1, Math.max(0, root.progress))
      }
    }
  }

  Item {
    id: inner
    anchors.fill: parent
  }
}
