import QtQuick
import qs.Commons
import qs.Ui

// Bar view of the pomodoro service, and the host for its popup. One
// instance per monitor; all of them read the same service, so every screen
// shows the same countdown. A left click opens or closes the popup, which
// holds every control; nothing else on the bar acts on the timer.
BarWidget {
  id: root
  moduleName: "nambrosini.pomarchy"

  property var service: null

  // The service can mount after the widget; look it up until it appears.
  function attachService() {
    var found = root.bar && root.bar.shell && typeof root.bar.shell.serviceFor === "function"
      ? root.bar.shell.serviceFor("nambrosini.pomarchy") : null
    if (found !== root.service) root.service = found
    if (root.service) root.service.configure(root.settings)
    root.injectPanel()
  }

  onBarChanged: attachService()
  onSettingsChanged: {
    if (root.service) root.service.configure(root.settings)
    root.injectPanel()
  }
  Component.onCompleted: attachService()

  Timer {
    interval: 1000
    repeat: true
    running: root.service === null
    onTriggered: root.attachService()
  }

  readonly property string label: {
    if (!root.service) return ""
    if (root.vertical || root.service.barText === "") return root.service.icon
    return root.service.icon + " " + root.service.barText
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight
  visible: root.service !== null

  readonly property bool urgent: root.service ? root.service.urgent : false

  // Gentle pulse while a phase change waits for confirmation. It animates the
  // root, not the button: WidgetButton binds its own opacity to `dimmed`, and
  // writing to that would break the paused dimming for good.
  SequentialAnimation on opacity {
    running: root.urgent
    loops: Animation.Infinite
    onRunningChanged: if (!running) root.opacity = 1
    NumberAnimation { to: 0.45; duration: 700; easing.type: Easing.InOutSine }
    NumberAnimation { to: 1; duration: 700; easing.type: Easing.InOutSine }
  }

  // ---- Popup. Shape contract for shell.summon/hide/toggle routing:
  //      Bar.findPanelWidget requires open/close/opened on the bar-widget
  //      root (mirrors the clock widget).
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item) panelLoader.item.close()
  }

  function togglePanel() {
    if (panelLoader.item) panelLoader.item.toggle()
  }

  readonly property real openPanelIndicatorWidth: button.labelWidth

  // Lets this widget stand in for the panel as the bar's popout identity:
  // Bar.requestPopout prefers closeForPopoutSwitch over close, and
  // KeyboardPanel reads popoutSwitchClosing back off its owner.
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    target.bar = root.bar
    target.settings = root.settings
    target.anchorItem = button
    target.hostWidget = root
    target.service = root.service
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.label
    tooltipText: root.service ? root.service.tooltip : ""
    active: root.urgent
    dimmed: root.service ? root.service.paused : false

    // WidgetButton only reads the tooltip on hover-enter; keep it live.
    onTooltipTextChanged: if (button.tooltipHovered && root.bar) root.bar.showTooltip(button, button.tooltipText)

    onPressed: function(mouseButton) {
      if (mouseButton === Qt.LeftButton) root.togglePanel()
    }
  }
}
