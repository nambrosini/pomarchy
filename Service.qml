import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// The one timer. The shell mounts a single service instance while every
// monitor gets its own bar widget, so the state lives here and the widgets
// only render it and forward clicks.
Item {
  id: root

  property var shell: null
  property var settings: ({})

  readonly property var config: Model.normalizeConfig(settings)
  property var timerState: Model.initialState()
  property double now: Date.now()

  readonly property string barText: Model.barText(timerState, now)
  readonly property string icon: Model.icon(timerState)
  readonly property string tooltip: Model.tooltip(timerState, config, now)
  readonly property bool urgent: Model.isUrgent(timerState)
  readonly property bool paused: Model.isPaused(timerState)
  // Everything the popup renders; the 500 ms tick moves the ring.
  readonly property var panelView: Model.panelView(timerState, config, now)
  // Daily totals of finished work sessions, for the popup's stats view.
  property var stats: Model.emptyStats()
  // Changes once a day, so the 371-square graph isn't rebuilt every tick.
  readonly property string todayKey: Model.dayKey(now)

  // Fired once on the tick a phase ends; alerts hang off this.
  signal phaseEnded()
  onPhaseEnded: alert(true)

  // Survives plugin hot-reload (not a shell restart); the state file below
  // covers restarts.
  PersistentProperties {
    id: persisted
    reloadableId: "nambrosini-pomarchy"
    property string saved: ""
    property int notificationId: 0
    onLoaded: root.reviveNotification()
  }

  // ---- Persistence

  readonly property var stateEnv: ({
    XDG_STATE_HOME: Quickshell.env("XDG_STATE_HOME"),
    HOME: Quickshell.env("HOME"),
  })
  readonly property string stateDir: Model.stateDir(stateEnv)
  readonly property string legacyStateDir: Model.legacyStateDir(stateEnv)
  // Nothing is written until the saved state has been read, so a fresh
  // instance can never clobber a running timer with its initial idle state.
  property bool stateLoaded: false
  // FileView reads as soon as it has a path, which can be before the folder
  // exists or the pre-rename state has been copied in; such a read must not
  // count, or the timer would start empty.
  property bool stateDirReady: false
  // Settings arrive from the bar widget. Holding the first tick until they
  // do keeps a phase that ended during downtime from alerting with default
  // durations; the fallback below covers a widget that never attaches.
  property bool configured: false
  property bool started: false

  // Read the saved state only once the folder exists and any state from
  // before the rename has been copied in (a first run lands in onLoadFailed).
  Process {
    id: ensureDirProc
    command: Model.prepareStateDirCommand(root.stateDir, root.legacyStateDir)
    running: false
    onExited: {
      root.stateDirReady = true
      stateFile.reload()
    }
  }

  FileView {
    id: stateFile
    path: root.stateDir + "/state.json"
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: root.loadState(text())
    // First run: no file yet.
    onLoadFailed: root.loadState("")
  }

  function loadState(fileText) {
    // FileView can report a load more than once during startup.
    if (root.stateLoaded || !root.stateDirReady) return
    root.timerState = Model.restore(Model.pickSaved(persisted.saved, fileText), root.config, Date.now())
    root.stateLoaded = true
    root.startIfReady()
    statsFile.reload()
  }

  // ---- Stats archive: stats.json beside state.json, so a timer state that
  //      restores to idle never takes the history with it.
  property bool statsLoaded: false

  FileView {
    id: statsFile
    path: root.stateDir + "/stats.json"
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: root.loadStats(text())
    onLoadFailed: root.loadStats("")
  }

  Process {
    id: statsBackupProc
    running: false
    // Only now may the fresh archive replace the unreadable one.
    onExited: root.finishLoadingStats()
  }

  function loadStats(fileText) {
    // Seeding needs the restored history, so wait for the timer state.
    if (root.statsLoaded || !root.stateLoaded || statsBackupProc.running) return
    var result = Model.loadStats(fileText, root.timerState.history)
    root.stats = result.stats
    if (result.backup) {
      statsBackupProc.command = ["cp", statsFile.path, statsFile.path + ".bad-" + Date.now()]
      statsBackupProc.running = true
    } else {
      root.finishLoadingStats()
    }
  }

  function finishLoadingStats() {
    root.statsLoaded = true
    root.saveStats()
  }

  function saveStats() {
    statsFile.setText(Model.serializeStats(root.stats) + "\n")
  }

  function startIfReady() {
    if (root.started || !root.stateLoaded || !root.configured) return
    root.started = true
    root.reviveNotification()
    // A phase that ran out while the shell was down ends (and alerts) now.
    root.tick()
  }

  Timer {
    interval: 3000
    running: !root.configured
    onTriggered: root.configure(root.settings)
  }

  // A hot-reload kills the notify-send that was waiting on the popup, so its
  // click would go nowhere: swap it for a live one (without the sound). After
  // a full restart the id is gone and the urgent bar alone asks.
  function reviveNotification() {
    if (root.started && root.timerState.phase === "awaiting"
        && persisted.notificationId > 0 && root.activeNotify === null)
      root.alert(false)
  }

  function apply(next) {
    if (next === root.timerState) return
    var previous = root.timerState
    root.timerState = next
    var saved = Model.serialize(next)
    persisted.saved = saved
    if (root.stateLoaded) stateFile.setText(saved + "\n")
    var delta = Model.statsDelta(previous, next, root.now)
    if (delta.length > 0 && root.statsLoaded) {
      root.stats = Model.applyStatsDelta(root.stats, delta)
      root.saveStats()
    }
    if (previous.phase === "awaiting" && next.phase !== "awaiting") root.dismissNotification()
    if (Model.isTransition(previous, next)) root.phaseEnded()
  }

  // ---- Phase-change alerts

  function alert(withSound) {
    var sound = withSound ? Model.soundCommand(root.config) : []
    if (sound.length > 0) Quickshell.execDetached(sound)

    root.dismissNotification()
    var command = Model.notifyCommand(root.timerState, root.config)
    if (command.length === 0) return
    // A fresh process per popup: the previous one exits by itself once its
    // popup is closed, and knows which id it owned when it does.
    var run = notifyRunComponent.createObject(root, { command: command })
    if (!run) return
    root.activeNotify = run
    run.running = true
  }

  function dismissNotification() {
    var command = Model.closeNotificationCommand(persisted.notificationId)
    persisted.notificationId = 0
    if (command.length > 0) Quickshell.execDetached(command)
  }

  property var activeNotify: null

  function handleNotifyLine(run, line) {
    var parsed = Model.parseNotifyLine(line, run.notificationId > 0)
    if (!parsed) return
    if (parsed.id) {
      run.notificationId = parsed.id
      if (run === root.activeNotify) persisted.notificationId = parsed.id
    } else if (parsed.action === "default"
               && Model.isCurrentNotification(persisted.notificationId, run.notificationId)) {
      // The popup is already gone once it reports a click.
      persisted.notificationId = 0
      root.now = Date.now()
      root.apply(Model.confirmPending(root.timerState, root.config, root.now))
    }
  }

  // Closed without a click (or replaced): forget the id so a hot-reload
  // does not resurrect a popup the user already dismissed.
  function notifyExited(run) {
    persisted.notificationId = Model.notificationClosed(persisted.notificationId, run.notificationId)
    if (run === root.activeNotify) root.activeNotify = null
    run.destroy()
  }

  Component {
    id: notifyRunComponent
    Process {
      id: run
      property int notificationId: 0
      stdout: SplitParser {
        onRead: function(line) { root.handleNotifyLine(run, line) }
      }
      onExited: root.notifyExited(run)
    }
  }

  function configure(widgetSettings) {
    root.settings = widgetSettings || ({})
    root.configured = true
    root.startIfReady()
  }

  function tick() {
    root.now = Date.now()
    root.apply(Model.tick(root.timerState, root.config, root.now))
  }

  function toggle() { root.now = Date.now(); root.apply(Model.toggle(root.timerState, root.config, root.now)) }
  function confirm() { root.now = Date.now(); root.apply(Model.confirm(root.timerState, root.config, root.now)) }
  function skip() { root.now = Date.now(); root.apply(Model.skip(root.timerState, root.config, root.now)) }
  function next() { root.now = Date.now(); root.apply(Model.next(root.timerState, root.config, root.now)) }
  function back() { root.now = Date.now(); root.apply(Model.back(root.timerState, root.config, root.now)) }
  function stop() { root.now = Date.now(); root.apply(Model.stop(root.timerState)) }
  function reset() { root.now = Date.now(); root.apply(Model.reset()) }
  function adjust(deltaMinutes) { root.now = Date.now(); root.apply(Model.adjust(root.timerState, root.now, deltaMinutes)) }
  function start(minutes) {
    root.now = Date.now()
    var next = Model.start(root.timerState, root.config, root.now, minutes)
    if (next === root.timerState) return "busy"
    root.apply(next)
    return "ok"
  }

  // Half-second ticks keep the seconds digit from visibly skipping; the
  // countdown itself is computed from endsAt, so tick timing never drifts it.
  Timer {
    interval: 500
    repeat: true
    running: root.started && root.timerState.running
    onTriggered: root.tick()
  }

  // `omarchy-shell pomarchy <method>`, for keybindings and scripts. The
  // service is the only instance, so the target is never registered twice.
  IpcHandler {
    target: "pomarchy"

    function toggle(): string { root.toggle(); return "ok" }
    function confirm(): string { root.confirm(); return "ok" }
    function skip(): string { root.skip(); return "ok" }
    function back(): string { root.back(); return "ok" }
    function stop(): string { root.stop(); return "ok" }
    function reset(): string { root.reset(); return "ok" }
    function adjust(minutes: int): string { root.adjust(minutes); return "ok" }
    function start(minutes: int): string { return root.start(minutes) }
    function status(): string {
      root.now = Date.now()
      return JSON.stringify(Model.status(root.timerState, root.config, root.now))
    }
  }

  Component.onCompleted: {
    ensureDirProc.running = true
  }
}
