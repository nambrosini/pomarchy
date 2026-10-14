import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model

// The pomodoro popup: the time inside a progress ring, player-style
// controls, today's sessions, and folded-away settings and shortcuts.
// Everything it shows comes from the service's panelView (Model.panelView),
// so this file only renders and forwards.
//
// BarWidget.qml owns the bar label and hands this panel the service, the
// button to anchor against, and itself as the bar identity.
Panel {
  id: root
  moduleName: "nambrosini.pomodoro"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  // The bar tracks the widget mounted in its slot, not this nested panel,
  // so the popout coordinator has to see that widget (as in the clock).
  readonly property var barIdentity: hostWidget || root

  readonly property var timer: service ? service.panelView : Model.panelView(Model.initialState(), Model.normalizeConfig(settings), 0)
  readonly property var minutes: Model.settingsMinutes(service ? service.config : Model.normalizeConfig(settings))

  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property color mutedForeground: Qt.darker(contentForeground, 1.5)
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color ringColor: timer.urgent && bar ? bar.urgent
    : (timer.paused ? mutedForeground : Color.accent)

  // Which face the popup shows: the timer, or the stats graph.
  property string view: "timer"
  // Last day of the graph's year; "" follows today.
  property string statsEnd: ""
  readonly property string todayKey: service ? service.todayKey : Model.dayKey(Date.now())
  readonly property string statsEndKey: statsEnd !== "" ? statsEnd : todayKey
  readonly property var stats: service ? service.stats : Model.emptyStats()
  readonly property bool statsEmpty: Object.keys(stats.days).length === 0
  readonly property var grid: Model.contributionGrid(stats, statsEndKey, Qt.locale().firstDayOfWeek, todayKey)
  readonly property var statsTiles: Model.statTiles(Model.statsSummary(stats, grid.startKey, grid.endKey, todayKey))

  readonly property var durationRows: [
    { key: "workMinutes", label: "Work session" },
    { key: "shortBreakMinutes", label: "Short break" },
    { key: "longBreakMinutes", label: "Long break" },
  ]

  readonly property var shortcuts: [
    { key: "Space · Enter", action: "Play / pause" },
    { key: "h · ←", action: "Back" },
    { key: "l · →", action: "Next" },
    { key: "s", action: "Stop" },
    { key: "g", action: "Stats" },
    { key: "Esc", action: "Close" },
  ]

  // The panel object outlives each opening, so fold the sections on close:
  // they start folded every time the popup appears.
  onOpenedChanged: if (!opened) {
    settingsSection.expanded = false
    shortcutsSection.expanded = false
    root.view = "timer"
    root.statsEnd = ""
  }

  function open() {
    root.controller.show()
    // After showing: the popout handoff clears the shared flag first.
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
    })
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && typeof root.bar.setCenterHoverRevealSuppressed === "function")
      root.bar.setCenterHoverRevealSuppressed(value)
  }

  function toggleTimer() { if (root.service) root.service.toggle() }
  function back() { if (root.service) root.service.back() }
  function next() { if (root.service) root.service.next() }
  function stop() { if (root.service) root.service.stop() }

  function toggleStats() {
    root.view = root.view === "stats" ? "timer" : "stats"
  }

  function pageYear(delta) {
    var next = Model.shiftYear(root.statsEndKey, delta, root.todayKey)
    root.statsEnd = next === root.todayKey ? "" : next
  }

  // Applied locally first so the popup redraws on the click; the shell.json
  // write comes back through the bar as the same value. The host widget
  // forwards its settings to the service, so the timer follows at once.
  // With no writable entry it stays a session-only change (as in the clock).
  function persistSettings(values) {
    var entry = { id: root.moduleName }
    for (var existing in root.settings) if (existing !== "id") entry[existing] = root.settings[existing]
    for (var key in values) entry[key] = values[key]

    root.settings = entry
    if (root.hostWidget && "settings" in root.hostWidget) root.hostWidget.settings = entry
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry)
  }

  function setSetting(key, value) {
    if (root.minutes[key] === value) return
    var values = {}
    values[key] = value
    persistSettings(values)
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    // contentWidth includes the card's padding and border (fittedContentHeight
    // adds that inset itself; fittedContentWidth does not), so the stats face
    // is sized from the graph's real width rather than a guessed constant.
    contentWidth: panel.fittedContentWidth(root.view === "stats"
      ? statsGraph.implicitWidth + panel.padding * 2 + Border.left(panel.borderSpec) + Border.right(panel.borderSpec)
      : Style.space(360))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      // In stats the arrows page years and Esc goes back to the timer;
      // the timer's own keys do nothing there.
      onActivateRequested: if (root.view === "timer") root.toggleTimer()
      onMoveRequested: function(dx, dy) {
        if (dx === 0) return
        if (root.view === "stats") root.pageYear(dx)
        else if (dx < 0) root.back()
        else root.next()
      }
      onTextKey: function(t) {
        if (t === "g" || t === "G") root.toggleStats()
        else if ((t === "s" || t === "S") && root.view === "timer") root.stop()
      }
      onCloseRequested: {
        if (root.view === "stats") root.view = "timer"
        else root.close()
      }
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Flickable {
        id: scroll
        anchors.fill: parent
        contentWidth: column.width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height || contentWidth > width

        Column {
          id: column
          // Never narrower than the graph, which scrolls on a narrow screen.
          width: Math.max(scroll.width, root.view === "stats" ? statsGraph.implicitWidth : 0)
          spacing: Style.space(12)

          Column {
            id: timerView
            width: parent.width
            spacing: Style.space(12)
            visible: root.view === "timer"

            // ---- Hero: time left (or the next phase's length) in the ring.
            Item {
              width: parent.width
              height: ring.height

              PanelActionButton {
                anchors.right: parent.right
                anchors.top: parent.top
                iconText: "\u{F0128}"  // chart-bar
                tooltipText: "Stats"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                onClicked: root.toggleStats()
              }

              ProgressRing {
                id: ring
                anchors.horizontalCenter: parent.horizontalCenter
                width: Style.space(180)
                height: Style.space(180)
                thickness: Style.space(8)
                progress: root.timer.progress
                color: root.ringColor
                trackColor: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.12)

                Column {
                  anchors.centerIn: parent
                  spacing: Style.space(2)

                  Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    textFormat: Text.PlainText
                    text: root.timer.title
                    color: root.timer.urgent && root.bar ? root.bar.urgent : root.mutedForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.bodySmall
                  }

                  Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    textFormat: Text.PlainText
                    text: root.timer.display
                    color: root.timer.paused ? root.mutedForeground : root.contentForeground
                    font.family: root.contentFontFamily
                    // Decorative hero size, like the clock's date.
                    font.pixelSize: Math.round(Style.font.displayLarge * 1.5)
                    font.bold: true
                  }
                }
              }
            }

            // ---- Controls: back · play/pause · next · stop.
            Row {
              anchors.horizontalCenter: parent.horizontalCenter
              spacing: Style.space(14)

              PanelActionButton {
                iconText: "\u{F04AE}"  // skip-previous
                tooltipText: "Back"
                enabled: root.timer.canBack
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                fontSize: Style.font.displayLarge
                onClicked: root.back()
              }

              PanelActionButton {
                iconText: root.timer.playing ? "\u{F03E4}" : "\u{F040A}"  // pause / play
                tooltipText: root.timer.playing ? "Pause" : "Play"
                foreground: root.contentForeground
                hoverColor: Color.accent
                bordered: true
                fontFamily: root.contentFontFamily
                fontSize: Style.font.displayLarge
                onClicked: root.toggleTimer()
              }

              PanelActionButton {
                iconText: "\u{F04AD}"  // skip-next
                tooltipText: "Next"
                enabled: root.timer.canNext
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                fontSize: Style.font.displayLarge
                onClicked: root.next()
              }

              PanelActionButton {
                iconText: "\u{F04DB}"  // stop
                tooltipText: "Stop"
                enabled: root.timer.canStop
                foreground: root.contentForeground
                hoverColor: root.bar ? root.bar.urgent : root.contentForeground
                fontFamily: root.contentFontFamily
                fontSize: Style.font.displayLarge
                onClicked: root.stop()
              }
            }

            // ---- Today: cycle dots and the finished phases, newest first.
            PanelSeparator { foreground: root.contentForeground }

            Item {
              width: parent.width
              height: todayHeader.implicitHeight

              PanelSectionHeader {
                id: todayHeader
                text: "TODAY"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
              }

              Text {
                anchors.right: parent.right
                anchors.verticalCenter: todayHeader.verticalCenter
                textFormat: Text.PlainText
                text: root.timer.dots
                color: root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                font.letterSpacing: 2
              }
            }

            Text {
              visible: root.timer.history.length === 0
              textFormat: Text.PlainText
              text: "No sessions yet today"
              color: root.mutedForeground
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.bodySmall
            }

            Column {
              width: parent.width
              spacing: Style.space(4)
              visible: root.timer.history.length > 0

              Repeater {
                model: root.timer.history

                Item {
                  required property var modelData
                  width: parent.width
                  height: rowLabel.implicitHeight

                  Text {
                    id: rowIcon
                    width: Style.space(22)
                    anchors.verticalCenter: parent.verticalCenter
                    textFormat: Text.PlainText
                    text: modelData.icon
                    color: root.mutedForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                  }

                  Text {
                    id: rowLabel
                    anchors.left: rowIcon.right
                    anchors.verticalCenter: parent.verticalCenter
                    textFormat: Text.PlainText
                    text: modelData.label
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.bodySmall
                  }

                  Text {
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    textFormat: Text.PlainText
                    text: modelData.range + "  ·  " + modelData.minutes + " min"
                    color: root.mutedForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.bodySmall
                  }
                }
              }
            }

            // ---- Settings (folded). Chips write to shell.json.
            CollapsibleSection {
              id: settingsSection
              title: "SETTINGS"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily

              Repeater {
                model: root.durationRows

                Column {
                  required property var modelData
                  width: parent.width
                  spacing: Style.space(4)

                  Text {
                    textFormat: Text.PlainText
                    text: modelData.label
                      + (Model.customNote(modelData.key, root.minutes[modelData.key]) !== ""
                        ? "  ·  " + Model.customNote(modelData.key, root.minutes[modelData.key]) : "")
                    color: root.mutedForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.bodySmall
                  }

                  ButtonGroup {
                    options: Model.durationOptions(modelData.key)
                    value: Model.chipValue(modelData.key, root.minutes[modelData.key])
                    focusable: false
                    spacing: Style.space(6)
                    foreground: root.contentForeground
                    fontFamily: root.contentFontFamily
                    fontSize: Style.font.bodySmall
                    onChanged: function(value) { root.setSetting(modelData.key, Number(value)) }
                  }
                }
              }

              Item {
                width: parent.width
                height: cyclesRow.implicitHeight

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  textFormat: Text.PlainText
                  text: "Cycles before long break"
                  color: root.mutedForeground
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.bodySmall
                }

                Row {
                  id: cyclesRow
                  anchors.right: parent.right
                  spacing: Style.space(8)

                  PanelActionButton {
                    iconText: "\u{F0374}"  // minus
                    tooltipText: "Fewer"
                    enabled: root.minutes.sessionsBeforeLongBreak > 1
                    bordered: true
                    foreground: root.contentForeground
                    fontFamily: root.contentFontFamily
                    onClicked: root.setSetting("sessionsBeforeLongBreak", Model.stepCycles(root.minutes.sessionsBeforeLongBreak, -1))
                  }

                  Text {
                    anchors.verticalCenter: parent.verticalCenter
                    width: Style.space(22)
                    horizontalAlignment: Text.AlignHCenter
                    textFormat: Text.PlainText
                    text: String(root.minutes.sessionsBeforeLongBreak)
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    font.bold: true
                  }

                  PanelActionButton {
                    iconText: "\u{F0415}"  // plus
                    tooltipText: "More"
                    enabled: root.minutes.sessionsBeforeLongBreak < 12
                    bordered: true
                    foreground: root.contentForeground
                    fontFamily: root.contentFontFamily
                    onClicked: root.setSetting("sessionsBeforeLongBreak", Model.stepCycles(root.minutes.sessionsBeforeLongBreak, 1))
                  }
                }
              }
            }

            // ---- Shortcuts (folded): only the keys that work in this popup.
            CollapsibleSection {
              id: shortcutsSection
              title: "SHORTCUTS"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily

              Repeater {
                model: root.shortcuts

                Item {
                  required property var modelData
                  width: parent.width
                  height: keyText.implicitHeight

                  Text {
                    id: keyText
                    textFormat: Text.PlainText
                    text: modelData.key
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.bodySmall
                    font.bold: true
                  }

                  Text {
                    anchors.right: parent.right
                    textFormat: Text.PlainText
                    text: modelData.action
                    color: root.mutedForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.bodySmall
                  }
                }
              }
            }
          }

          // ---- Stats: the year of finished work sessions, GitHub-style.
          Column {
            id: statsView
            width: parent.width
            spacing: Style.space(12)
            visible: root.view === "stats"

            Item {
              width: parent.width
              height: Math.max(statsBack.height, statsTitle.implicitHeight)

              Row {
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(8)

                PanelActionButton {
                  id: statsBack
                  iconText: "\u{F004D}"  // arrow-left
                  tooltipText: "Back to the timer"
                  foreground: root.contentForeground
                  fontFamily: root.contentFontFamily
                  onClicked: root.view = "timer"
                }

                Text {
                  id: statsTitle
                  anchors.verticalCenter: parent.verticalCenter
                  textFormat: Text.PlainText
                  text: "Stats"
                  color: root.contentForeground
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.heading
                  font.bold: true
                }
              }

              Row {
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(8)

                PanelActionButton {
                  iconText: "\u{F0141}"  // chevron-left
                  tooltipText: "Previous year"
                  foreground: root.contentForeground
                  fontFamily: root.contentFontFamily
                  onClicked: root.pageYear(-1)
                }

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  textFormat: Text.PlainText
                  text: root.grid.rangeLabel
                  color: root.mutedForeground
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.bodySmall
                }

                PanelActionButton {
                  iconText: "\u{F0142}"  // chevron-right
                  tooltipText: "Next year"
                  enabled: root.statsEnd !== ""
                  foreground: root.contentForeground
                  fontFamily: root.contentFontFamily
                  onClicked: root.pageYear(1)
                }
              }
            }

            ContributionGraph {
              id: statsGraph
              grid: root.grid
              foreground: root.contentForeground
              accent: Color.accent
              fontFamily: root.contentFontFamily
            }

            Row {
              spacing: Style.space(28)

              Repeater {
                model: root.statsTiles

                Column {
                  required property var modelData
                  spacing: Style.space(2)

                  Text {
                    textFormat: Text.PlainText
                    text: modelData.value
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.heading
                    font.bold: true
                  }

                  Text {
                    textFormat: Text.PlainText
                    text: modelData.label
                    color: root.mutedForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                  }
                }
              }
            }

            Text {
              visible: root.statsEmpty
              textFormat: Text.PlainText
              text: "Sessions are counted from the day this view arrived; nothing older was kept."
              color: root.mutedForeground
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.bodySmall
            }
          }
        }
      }
    }
  }
}
