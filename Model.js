// Pure pomodoro state machine for the bar widget. No Qt, no I/O and no
// clock reads: every function takes `now` (epoch ms) and returns a new
// state, so it is unit tested under node (tests/model.test.mjs) and the
// QML only owns timers, processes, and rendering.
//
// A timed phase stores an absolute `endsAt` instead of counting down, so the
// timer neither drifts nor loses time across a shell restart. When a phase
// ends the state parks in "awaiting" until the user confirms the next one.

var MS_PER_MINUTE = 60000
var MAX_MINUTES = 180
var MAX_SESSIONS = 12
var MAX_HISTORY = 50
// Back within this long of a phase starting goes to the previous phase
// instead of restarting the current one, as on a music player.
var BACK_GRACE_MS = 5000
var DEFAULT_SOUND = "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga"

var PHASES = ["idle", "work", "short", "long", "awaiting"]
var TIMED_PHASES = ["work", "short", "long"]

var PHASE_LABELS = {
  work: "work session",
  short: "short break",
  long: "long break",
}

function positiveNumber(value, fallback, max) {
  var n = Number(value)
  if (value === null || value === "" || !isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

function normalizeConfig(settings) {
  var s = settings || {}
  return {
    workMs: positiveNumber(s.workMinutes, 25, MAX_MINUTES) * MS_PER_MINUTE,
    shortMs: positiveNumber(s.shortBreakMinutes, 5, MAX_MINUTES) * MS_PER_MINUTE,
    longMs: positiveNumber(s.longBreakMinutes, 15, MAX_MINUTES) * MS_PER_MINUTE,
    sessionsBeforeLongBreak: Math.max(1, Math.floor(positiveNumber(s.sessionsBeforeLongBreak, 4, MAX_SESSIONS))),
    notify: s.notify !== false && s.notify !== "false",
    sound: typeof s.sound === "string" ? s.sound : DEFAULT_SOUND,
  }
}

// `completed` is the lifetime count of work sessions; `cycle` counts the ones
// since the last long break, so changing sessionsBeforeLongBreak mid-cycle
// moves the goal instead of re-deriving progress from `completed`.
// `history` holds today's finished phases for the popup.
function initialState() {
  return {
    phase: "idle", running: false, endsAt: 0, remainingMs: 0, completed: 0, next: "work", finished: "",
    cycle: 0, durationMs: 0, startedAt: 0, history: [],
  }
}

function copy(state) {
  return {
    phase: state.phase,
    running: state.running,
    endsAt: state.endsAt,
    remainingMs: state.remainingMs,
    completed: state.completed,
    next: state.next,
    finished: state.finished,
    cycle: state.cycle,
    durationMs: state.durationMs,
    startedAt: state.startedAt,
    history: state.history.slice(),
  }
}

function isTimed(phase) {
  return TIMED_PHASES.indexOf(phase) !== -1
}

function durationFor(phase, config) {
  if (phase === "short") return config.shortMs
  if (phase === "long") return config.longMs
  return config.workMs
}

function begin(state, phase, config, now) {
  var s = copy(state)
  s.phase = phase
  s.running = true
  s.durationMs = durationFor(phase, config)
  s.startedAt = now
  s.endsAt = now + s.durationMs
  s.remainingMs = 0
  s.next = ""
  s.finished = ""
  return s
}

// A natural end is recorded at endsAt (the tick that notices it can be
// late); a skip at the moment of skipping. The time spent excludes pauses.
function finish(state, config, now) {
  var endedAt = state.running ? Math.min(now, state.endsAt) : now
  var ms = Math.max(0, state.durationMs - remaining(state, endedAt))
  var s = copy(state)
  s.history.push({ phase: state.phase, startedAt: state.startedAt > 0 ? state.startedAt : endedAt - ms, endedAt: endedAt, ms: ms })
  s.history = pruneHistory(s.history, now)
  s.finished = state.phase
  if (state.phase === "work") {
    s.completed = state.completed + 1
    s.cycle = state.cycle + 1
    s.next = s.cycle >= config.sessionsBeforeLongBreak ? "long" : "short"
  } else {
    // The cycle stays full through the long break and starts over after it.
    if (state.phase === "long") s.cycle = 0
    s.next = "work"
  }
  s.phase = "awaiting"
  s.running = false
  s.endsAt = 0
  s.remainingMs = 0
  return s
}

function startOfDay(now) {
  var d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Today's entries only (local midnight), newest MAX_HISTORY kept.
function pruneHistory(history, now) {
  var midnight = startOfDay(now)
  var kept = history.filter(function(entry) { return entry.endedAt >= midnight })
  return kept.slice(Math.max(0, kept.length - MAX_HISTORY))
}

function start(state, config, now) {
  return state.phase === "idle" ? begin(state, "work", config, now) : state
}

function confirm(state, config, now) {
  if (state.phase === "idle") return begin(state, "work", config, now)
  if (state.phase === "awaiting") return begin(state, state.next, config, now)
  return state
}

function pause(state, now) {
  if (!state.running) return state
  var s = copy(state)
  s.running = false
  s.remainingMs = Math.max(0, state.endsAt - now)
  s.endsAt = 0
  return s
}

function resume(state, now) {
  if (state.running || !isTimed(state.phase)) return state
  var s = copy(state)
  s.running = true
  s.endsAt = now + state.remainingMs
  s.remainingMs = 0
  return s
}

// One action for the primary click: start, pause, resume, or confirm.
function toggle(state, config, now) {
  if (state.phase === "idle" || state.phase === "awaiting") return confirm(state, config, now)
  return state.running ? pause(state, now) : resume(state, now)
}

function tick(state, config, now) {
  if (state.running && isTimed(state.phase) && now >= state.endsAt) return finish(state, config, now)
  return state
}

// Ends a timed phase now (counted as done); while awaiting a break, skips
// the break and starts work.
function skip(state, config, now) {
  if (isTimed(state.phase)) return finish(state, config, now)
  if (state.phase === "awaiting" && state.next !== "work") {
    var s = begin(state, "work", config, now)
    // A skipped long break still closes the cycle that earned it.
    if (state.next === "long") s.cycle = 0
    return s
  }
  return state
}

// The popup's "next" button: skip, and also start work when it is pending.
function next(state, config, now) {
  if (state.phase === "awaiting" && state.next === "work") return begin(state, "work", config, now)
  return skip(state, config, now)
}

// Ends the session without counting the stopped phase. Cycle progress and
// history stay, so play continues the cycle with a fresh work session.
function stop(state) {
  if (state.phase === "idle") return state
  var s = copy(state)
  s.phase = "idle"
  s.running = false
  s.endsAt = 0
  s.remainingMs = 0
  s.durationMs = 0
  s.startedAt = 0
  s.next = "work"
  s.finished = ""
  return s
}

function dropLast(history, phase) {
  var h = history.slice()
  if (h.length > 0 && h[h.length - 1].phase === phase) h.pop()
  return h
}

// Replays a finished phase: its history entry goes, and a work session's
// count is taken back.
function replay(state, phase, config, now) {
  var s = begin(state, phase, config, now)
  s.history = dropLast(state.history, phase)
  if (phase === "work") {
    s.completed = Math.max(0, state.completed - 1)
    s.cycle = Math.max(0, state.cycle - 1)
  } else if (phase === "long") {
    s.cycle = Math.max(state.cycle, config.sessionsBeforeLongBreak)
  }
  return s
}

// Music-player back: restart the phase once it is under way, otherwise go
// to the previous one. The phase before a work session is the break that
// led into it; before a break (or while awaiting) it is the phase that
// just ended.
function back(state, config, now) {
  if (state.phase === "idle") return state
  if (isTimed(state.phase) && state.durationMs - remaining(state, now) > BACK_GRACE_MS)
    return begin(state, state.phase, config, now)
  if (state.phase === "work") {
    if (state.completed === 0) return begin(state, "work", config, now)
    return replay(state, state.cycle === 0 ? "long" : "short", config, now)
  }
  if (state.phase === "awaiting") {
    var ended = isTimed(state.finished) ? state.finished : (state.next === "work" ? "short" : "work")
    return replay(state, ended, config, now)
  }
  return replay(state, "work", config, now)
}

function reset() {
  return initialState()
}

function adjust(state, now, deltaMinutes) {
  if (!isTimed(state.phase)) return state
  var before = remaining(state, now)
  var left = Math.max(MS_PER_MINUTE, before + deltaMinutes * MS_PER_MINUTE)
  var s = copy(state)
  s.durationMs = state.durationMs + left - before
  if (state.running) s.endsAt = now + left
  else s.remainingMs = left
  return s
}

function remaining(state, now) {
  if (!isTimed(state.phase)) return 0
  if (state.running) return Math.max(0, state.endsAt - now)
  return state.remainingMs
}

// True only for the tick on which a phase ended, so alerts fire once.
function isTransition(previous, current) {
  return previous.phase !== "awaiting" && current.phase === "awaiting"
}

function pad2(value) {
  return value < 10 ? "0" + value : String(value)
}

function formatRemaining(ms) {
  var seconds = ms > 0 ? Math.ceil(ms / 1000) : 0
  return pad2(Math.floor(seconds / 60)) + ":" + pad2(seconds % 60)
}

function barText(state, now) {
  if (state.phase === "idle") return ""
  if (state.phase === "awaiting") return state.next === "work" ? "Work?" : "Break?"
  return formatRemaining(remaining(state, now))
}

function notification(state, config) {
  var minutes = Math.round(durationFor(state.next, config) / MS_PER_MINUTE)
  return {
    summary: state.finished === "work" ? "Work session done" : "Break over",
    body: "Click to start a " + minutes + " min " + PHASE_LABELS[state.next],
  }
}

var PHASE_TITLES = {
  work: "Work session",
  short: "Short break",
  long: "Long break",
}

// Nerd Font Material Design glyphs, matching the rest of the Omarchy bar.
var ICONS = {
  idle: "\u{F051B}",      // timer-outline
  work: "\u{F051F}",      // timer-sand
  short: "\u{F0176}",     // coffee
  long: "\u{F04B2}",      // sleep
  paused: "\u{F03E4}",    // pause
  awaiting: "\u{F009E}",  // bell-ring
}

function isPaused(state) {
  return isTimed(state.phase) && !state.running
}

function icon(state) {
  if (isPaused(state)) return ICONS.paused
  return ICONS[state.phase] || ICONS.idle
}

function isUrgent(state) {
  return state.phase === "awaiting"
}

// Progress through the current long-break cycle. The cycle reads full from
// the moment the long break is earned until it is over.
function sessionDots(state, config) {
  var total = config.sessionsBeforeLongBreak
  var filled = Math.min(state.cycle, total)
  var dots = ""
  for (var i = 0; i < total; i++) dots += i < filled ? "●" : "○"
  return dots
}

function tooltip(state, config, now) {
  var dots = sessionDots(state, config)
  if (state.phase === "idle") {
    return "Pomodoro\nClick to open the timer · " + Math.round(config.workMs / MS_PER_MINUTE) + " min work sessions"
  }
  if (state.phase === "awaiting") {
    var prompt = notification(state, config)
    return prompt.summary + "\n" + prompt.body + "\n" + dots
  }
  var status = state.running ? "" : "paused · "
  return PHASE_TITLES[state.phase] + " · " + status + formatRemaining(remaining(state, now)) + " left\n" + dots
}

// ---- Popup panel

function formatClock(ms) {
  var d = new Date(ms)
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes())
}

// Everything the popup renders, so Panel.qml only binds to fields.
function panelView(state, config, now) {
  var timed = isTimed(state.phase)
  var title
  var display
  if (timed) {
    title = PHASE_TITLES[state.phase] + (state.running ? "" : " · paused")
    display = formatRemaining(remaining(state, now))
  } else {
    var upcoming = state.phase === "awaiting" ? state.next : "work"
    title = PHASE_TITLES[upcoming] + " next"
    display = formatRemaining(durationFor(upcoming, config))
  }
  var progress = timed && state.durationMs > 0
    ? Math.min(1, Math.max(0, (state.durationMs - remaining(state, now)) / state.durationMs)) : 0
  var active = state.phase !== "idle"
  return {
    title: title,
    display: display,
    progress: progress,
    playing: state.running,
    paused: isPaused(state),
    urgent: isUrgent(state),
    canBack: active,
    canNext: active,
    canStop: active,
    dots: sessionDots(state, config),
    history: pruneHistory(state.history, now).reverse().map(function(entry) {
      return {
        icon: ICONS[entry.phase],
        label: PHASE_TITLES[entry.phase],
        range: formatClock(entry.startedAt) + "–" + formatClock(entry.endedAt),
        minutes: Math.round(entry.ms / MS_PER_MINUTE),
      }
    }),
  }
}

// Chip choices in the popup's settings. Any other value set in shell.json
// stays valid; it just highlights no chip.
var DURATION_CHOICES = {
  workMinutes: [15, 25, 45, 60],
  shortBreakMinutes: [3, 5, 10, 15],
  longBreakMinutes: [10, 15, 20, 30],
}

function durationOptions(key) {
  return (DURATION_CHOICES[key] || []).map(function(minutes) {
    return { value: String(minutes), label: minutes + " min" }
  })
}

function isChoice(key, minutes) {
  return (DURATION_CHOICES[key] || []).indexOf(minutes) !== -1
}

function chipValue(key, minutes) {
  return isChoice(key, minutes) ? String(minutes) : ""
}

function customNote(key, minutes) {
  return isChoice(key, minutes) ? "" : "custom: " + minutes + " min"
}

function settingsMinutes(config) {
  return {
    workMinutes: Math.round(config.workMs / MS_PER_MINUTE),
    shortBreakMinutes: Math.round(config.shortMs / MS_PER_MINUTE),
    longBreakMinutes: Math.round(config.longMs / MS_PER_MINUTE),
    sessionsBeforeLongBreak: config.sessionsBeforeLongBreak,
  }
}

function stepCycles(current, delta) {
  return Math.min(MAX_SESSIONS, Math.max(1, current + delta))
}

// ---- Phase-change alerts. The QML runs these argv arrays; building them
//      here keeps the exact commands under test.

// Critical urgency keeps the popup on screen until it is answered (the
// Omarchy daemon gives critical popups no timeout). Clicking it invokes the
// "default" action, which notify-send prints after the --print-id line.
function notifyCommand(state, config) {
  if (state.phase !== "awaiting" || !config.notify) return []
  var prompt = notification(state, config)
  var actionLabel = "Start " + PHASE_LABELS[state.next]
  return ["notify-send", "--app-name=Pomodoro", "--urgency=critical", "--print-id",
    "--action=default=" + actionLabel, prompt.summary, prompt.body]
}

function soundCommand(config) {
  return config.sound === "" ? [] : ["pw-play", config.sound]
}

// One stdout line from notifyCommand: the id comes first, then the clicked
// action (nothing at all when the popup is closed without a click).
function parseNotifyLine(line, idKnown) {
  var text = String(line || "").trim()
  if (text === "") return null
  if (!idKnown) {
    var id = Number(text)
    return /^\d+$/.test(text) && id > 0 ? { id: id } : null
  }
  return { action: text }
}

function closeNotificationCommand(id) {
  if (!(id > 0)) return []
  return ["gdbus", "call", "--session", "--dest", "org.freedesktop.Notifications",
    "--object-path", "/org/freedesktop/Notifications",
    "--method", "org.freedesktop.Notifications.CloseNotification", String(id)]
}

// Each popup has its own notify-send process, and an older one can exit
// after a newer popup took over; only the current popup's id may be cleared
// or acted on.
function notificationClosed(currentId, closedId) {
  return currentId === closedId ? 0 : currentId
}

function isCurrentNotification(currentId, runId) {
  return runId > 0 && currentId === runId
}

// Confirmation that arrives from outside the bar (a notification click) only
// counts while a phase change is actually pending, so a stale popup cannot
// start a session after a reset.
function confirmPending(state, config, now) {
  return state.phase === "awaiting" ? confirm(state, config, now) : state
}

// Snapshot for `omarchy-shell pomodoro status`, so scripts and other bars can
// read the timer without parsing the label.
function status(state, config, now) {
  return {
    phase: state.phase,
    running: state.running,
    paused: isPaused(state),
    awaiting: state.phase === "awaiting",
    remainingMs: remaining(state, now),
    display: barText(state, now),
    next: state.next,
    completed: state.completed,
  }
}

// ---- Persistence. The state file is user state, not cache, so it goes
//      under XDG_STATE_HOME like Omarchy's own notification history.

function stateDir(env) {
  var base = env.XDG_STATE_HOME ? String(env.XDG_STATE_HOME).replace(/\/+$/, "") : env.HOME + "/.local/state"
  return base + "/omarchy-pomodoro"
}

// The in-memory copy only exists across a hot-reload and is written on every
// change, so it is never older than the file; the file covers shell restarts.
function pickSaved(reloadCopy, fileText) {
  if (reloadCopy) return String(reloadCopy)
  return fileText ? String(fileText) : ""
}

function serialize(state) {
  return JSON.stringify(copy(state))
}

function isCount(value) {
  return typeof value === "number" && isFinite(value) && value >= 0
}

function isHistoryEntry(entry) {
  return !!entry && typeof entry === "object" && isTimed(entry.phase)
    && isCount(entry.startedAt) && isCount(entry.endedAt) && isCount(entry.ms)
}

// Parses persisted state, falling back to idle on anything malformed. Files
// written before the popup lack cycle/durationMs/startedAt/history; those
// migrate (durations from `config`) rather than reset. With `now`, history
// from before today is dropped.
function restore(raw, config, now) {
  var data
  try {
    data = JSON.parse(raw)
  } catch (e) {
    return initialState()
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return initialState()
  if (PHASES.indexOf(data.phase) === -1 || typeof data.running !== "boolean") return initialState()
  if (!isCount(data.endsAt) || !isCount(data.remainingMs) || !isCount(data.completed)) return initialState()
  if (data.running && (!isTimed(data.phase) || data.endsAt <= 0)) return initialState()
  if (data.phase === "awaiting" && !isTimed(data.next)) return initialState()
  if (typeof data.next !== "string" || typeof data.finished !== "string") return initialState()
  for (var i = 0; i < 3; i++) {
    var key = ["cycle", "durationMs", "startedAt"][i]
    if (data[key] !== undefined && !isCount(data[key])) return initialState()
  }
  if (data.history !== undefined && !Array.isArray(data.history)) return initialState()

  var c = config || normalizeConfig({})
  var s = copy({
    phase: data.phase, running: data.running, endsAt: data.endsAt, remainingMs: data.remainingMs,
    completed: data.completed, next: data.next, finished: data.finished,
    cycle: data.cycle !== undefined ? data.cycle : data.completed % 4,
    durationMs: data.durationMs !== undefined ? data.durationMs : (isTimed(data.phase) ? durationFor(data.phase, c) : 0),
    startedAt: data.startedAt !== undefined ? data.startedAt : 0,
    history: (data.history || []).filter(isHistoryEntry),
  })
  // An old file whose cycle just completed: keep it full until the long break is over.
  if (data.cycle === undefined && s.cycle === 0 && s.completed > 0 && (s.phase === "long" || s.next === "long"))
    s.cycle = 4
  if (now !== undefined) s.history = pruneHistory(s.history, now)
  return s
}

// ---- Stats archive. Daily totals of finished work sessions, kept forever
//      in their own file (stats.json) so a reset timer state never takes
//      them along. Days are local calendar dates, walked with setDate so a
//      DST switch can neither skip nor repeat one.

var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
var WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
var GRAPH_WEEKS = 53
var DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function dateKey(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
}

function dayKey(ms) {
  return dateKey(new Date(ms))
}

// Noon, so no DST switch can move the date.
function keyToDate(key) {
  var parts = String(key).split("-")
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12)
}

function addDays(key, days) {
  var d = keyToDate(key)
  d.setDate(d.getDate() + days)
  return dateKey(d)
}

function emptyStats() {
  return { version: 1, days: {} }
}

function workEntryId(entry) {
  return entry.startedAt + ":" + entry.endedAt
}

function addToDelta(delta, entry, sign) {
  delta.push({ day: dayKey(entry.endedAt), sessions: sign, focusMs: sign * entry.ms })
}

// What a state change does to the archive. A work entry that appears is a
// finished session. One that disappears counts as taken back only when it
// is Back replaying it (the last entry goes and that phase restarts):
// midnight pruning and reset also drop entries, and those sessions happened.
function statsDelta(previous, next, now) {
  var delta = []
  var before = {}
  previous.history.forEach(function(entry) { before[workEntryId(entry)] = true })
  next.history.forEach(function(entry) {
    if (entry.phase === "work" && !before[workEntryId(entry)]) addToDelta(delta, entry, 1)
  })
  var last = previous.history[previous.history.length - 1]
  var replayed = last && last.phase === "work" && next.phase === "work"
    && next.history.length === previous.history.length - 1
  if (replayed) addToDelta(delta, last, -1)
  return delta
}

function applyStatsDelta(stats, delta) {
  var days = {}
  for (var key in stats.days) days[key] = { sessions: stats.days[key].sessions, focusMs: stats.days[key].focusMs }
  delta.forEach(function(change) {
    var day = days[change.day] || { sessions: 0, focusMs: 0 }
    day = { sessions: Math.max(0, day.sessions + change.sessions), focusMs: Math.max(0, day.focusMs + change.focusMs) }
    if (day.sessions > 0) days[change.day] = day
    else delete days[change.day]
  })
  return { version: 1, days: days }
}

function seedStats(history) {
  return applyStatsDelta(emptyStats(), statsDelta({ history: [] }, { phase: "idle", history: history }, 0))
}

function serializeStats(stats) {
  return JSON.stringify({ version: 1, days: stats.days })
}

// Null when the file can't be read as an archive at all; bad days are
// dropped one by one.
function restoreStats(raw) {
  var data
  try {
    data = JSON.parse(raw)
  } catch (e) {
    return null
  }
  if (!data || typeof data !== "object" || !data.days || typeof data.days !== "object" || Array.isArray(data.days)) return null
  var stats = emptyStats()
  for (var key in data.days) {
    var day = data.days[key]
    if (!DAY_KEY.test(key) || !day || typeof day !== "object") continue
    if (!isCount(day.sessions) || day.sessions < 1 || Math.floor(day.sessions) !== day.sessions) continue
    stats.days[key] = { sessions: day.sessions, focusMs: isCount(day.focusMs) ? day.focusMs : 0 }
  }
  return stats
}

// A missing file starts from today's history. A corrupt one does too, but
// asks the caller to keep a copy first, so an archive is never silently lost.
function loadStats(raw, history) {
  if (String(raw || "").trim() === "") return { stats: seedStats(history), backup: false }
  var stats = restoreStats(raw)
  return stats ? { stats: stats, backup: false } : { stats: seedStats(history), backup: true }
}

function sessionsOn(stats, key) {
  var day = stats.days[key]
  return day ? day.sessions : 0
}

// 0 for none, then 1–4 by quarters of the busiest day, as on GitHub.
function statsLevel(count, max) {
  if (count <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil(4 * count / max)))
}

function monthYear(key) {
  var d = keyToDate(key)
  return MONTH_NAMES[d.getMonth()] + " " + d.getFullYear()
}

// The year ending on endKey as GitHub draws it: 53 week columns starting on
// weekStart (0 = Sunday), the last holding endKey's week.
function contributionGrid(stats, endKey, weekStart, todayKey) {
  var start = ((Math.floor(Number(weekStart)) % 7) + 7) % 7
  if (!isFinite(start)) start = 1
  var end = keyToDate(endKey)
  var lastColumn = addDays(endKey, -((end.getDay() - start + 7) % 7))
  var cursor = addDays(lastColumn, -7 * (GRAPH_WEEKS - 1))
  var startKey = cursor
  var weeks = []
  var max = 0
  var monthLabels = []
  for (var w = 0; w < GRAPH_WEEKS; w++) {
    var week = []
    for (var d = 0; d < 7; d++) {
      var count = sessionsOn(stats, cursor)
      var future = cursor > endKey
      if (!future) max = Math.max(max, count)
      week.push({ key: cursor, count: future ? 0 : count, level: 0, future: future, today: cursor === todayKey })
      if (cursor.slice(8) === "01") monthLabels.push({ column: w, label: MONTH_NAMES[Number(cursor.slice(5, 7)) - 1] })
      cursor = addDays(cursor, 1)
    }
    weeks.push(week)
  }
  weeks.forEach(function(week) { week.forEach(function(cell) { cell.level = statsLevel(cell.count, max) }) })
  // The partial month at the start gets a label only where it can't crowd the next.
  if (monthLabels.length === 0 || monthLabels[0].column >= 3) {
    var lead = weeks[0][6].key
    monthLabels.unshift({ column: 0, label: MONTH_NAMES[Number(lead.slice(5, 7)) - 1] })
  }
  var dayLabels = []
  for (var r = 0; r < 7; r++) dayLabels.push(r % 2 === 0 && r < 6 ? WEEKDAY_NAMES[(start + r) % 7] : "")
  return {
    weeks: weeks, monthLabels: monthLabels, dayLabels: dayLabels, max: max,
    startKey: startKey, endKey: endKey, rangeLabel: monthYear(startKey) + " – " + monthYear(endKey),
  }
}

function dayTooltip(cell) {
  var d = keyToDate(cell.key)
  var when = WEEKDAY_NAMES[d.getDay()] + " " + d.getDate() + " " + MONTH_NAMES[d.getMonth()] + " " + d.getFullYear()
  var what = cell.count === 0 ? "No work sessions" : cell.count + (cell.count === 1 ? " work session" : " work sessions")
  return what + " · " + when
}

// Totals and the longest streak cover the window; the current streak runs
// back from today and still holds while today has no session yet.
function statsSummary(stats, startKey, endKey, todayKey) {
  var sessions = 0
  var focusMs = 0
  var longest = 0
  var run = 0
  var best = null
  var last = endKey < todayKey ? endKey : todayKey
  for (var key = startKey; key <= last; key = addDays(key, 1)) {
    var count = sessionsOn(stats, key)
    if (count > 0) {
      sessions += count
      focusMs += stats.days[key].focusMs
      run += 1
      longest = Math.max(longest, run)
      if (!best || count > best.sessions) best = { key: key, sessions: count }
    } else {
      run = 0
    }
  }
  var current = 0
  var day = sessionsOn(stats, todayKey) > 0 ? todayKey : addDays(todayKey, -1)
  while (sessionsOn(stats, day) > 0) {
    current += 1
    day = addDays(day, -1)
  }
  return {
    sessions: sessions,
    focusHours: Math.round(focusMs / (60 * MS_PER_MINUTE) * 10) / 10,
    currentStreak: current,
    longestStreak: longest,
    bestDay: best,
  }
}

// Pages the window a year at a time, never past today; Feb 29 lands on the 28th.
function shiftYear(endKey, delta, todayKey) {
  var d = keyToDate(endKey)
  var month = d.getMonth()
  d.setFullYear(d.getFullYear() + delta)
  if (d.getMonth() !== month) d.setDate(0)
  var key = dateKey(d)
  return key > todayKey ? todayKey : key
}

function statTiles(summary) {
  var best = summary.bestDay
  var bestDate = best ? keyToDate(best.key) : null
  return [
    { value: String(summary.sessions), label: "sessions" },
    { value: summary.focusHours + " h", label: "focus" },
    { value: summary.currentStreak + " d", label: "current streak" },
    { value: summary.longestStreak + " d", label: "longest streak" },
    best
      ? { value: String(best.sessions), label: "best day · " + WEEKDAY_NAMES[bestDate.getDay()] + " " + bestDate.getDate() + " " + MONTH_NAMES[bestDate.getMonth()] }
      : { value: "–", label: "best day" },
  ]
}
