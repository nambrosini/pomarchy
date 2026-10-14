// Unit tests for Model.js. The model is a QML JavaScript library (plain
// top-level functions, no module syntax), so it is evaluated into a vm
// context here the same way the QML engine sees it.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import { execFileSync } from "node:child_process"

const modelPath = new URL("../Model.js", import.meta.url)
const Model = vm.createContext({})
vm.runInContext(readFileSync(modelPath, "utf8"), Model, { filename: modelPath.pathname })

// Values created inside the vm context carry that realm's prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value))

const MIN = 60000
const T0 = 1_000_000_000_000
const cfg = () => Model.normalizeConfig({})

function finishPhase(state, config, now) {
  return Model.tick(state, config, state.endsAt > now ? state.endsAt : now)
}

describe("normalizeConfig", () => {
  test("uses classic pomodoro defaults", () => {
    assert.deepEqual(plain(Model.normalizeConfig({})), {
      workMs: 25 * MIN, shortMs: 5 * MIN, longMs: 15 * MIN, sessionsBeforeLongBreak: 4,
      notify: true, sound: "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga",
    })
  })

  test("notify can be turned off, including from a string", () => {
    assert.equal(Model.normalizeConfig({ notify: false }).notify, false)
    assert.equal(Model.normalizeConfig({ notify: "false" }).notify, false)
    assert.equal(Model.normalizeConfig({ notify: true }).notify, true)
  })

  test("an empty sound disables it; a non-string falls back to the default", () => {
    assert.equal(Model.normalizeConfig({ sound: "" }).sound, "")
    assert.equal(Model.normalizeConfig({ sound: "/tmp/ding.oga" }).sound, "/tmp/ding.oga")
    assert.equal(Model.normalizeConfig({ sound: 42 }).sound, Model.DEFAULT_SOUND)
  })

  test("accepts numeric strings from shell.json", () => {
    const c = Model.normalizeConfig({ workMinutes: "50", shortBreakMinutes: 10, longBreakMinutes: 30, sessionsBeforeLongBreak: "2" })
    assert.equal(c.workMs, 50 * MIN)
    assert.equal(c.shortMs, 10 * MIN)
    assert.equal(c.longMs, 30 * MIN)
    assert.equal(c.sessionsBeforeLongBreak, 2)
  })

  test("falls back on invalid, zero, or negative values", () => {
    const c = Model.normalizeConfig({ workMinutes: "abc", shortBreakMinutes: 0, longBreakMinutes: -3, sessionsBeforeLongBreak: null })
    assert.equal(c.workMs, 25 * MIN)
    assert.equal(c.shortMs, 5 * MIN)
    assert.equal(c.longMs, 15 * MIN)
    assert.equal(c.sessionsBeforeLongBreak, 4)
  })

  test("tolerates undefined settings", () => {
    assert.equal(Model.normalizeConfig(undefined).workMs, 25 * MIN)
  })

  test("clamps oversized durations to 180 minutes", () => {
    assert.equal(Model.normalizeConfig({ workMinutes: 999 }).workMs, 180 * MIN)
  })
})

describe("start / pause / resume", () => {
  test("initial state is idle and waits to start work", () => {
    const s = Model.initialState()
    assert.equal(s.phase, "idle")
    assert.equal(s.running, false)
    assert.equal(s.next, "work")
    assert.equal(s.completed, 0)
  })

  test("start from idle begins a running work phase", () => {
    const s = Model.start(Model.initialState(), cfg(), T0)
    assert.equal(s.phase, "work")
    assert.equal(s.running, true)
    assert.equal(s.endsAt, T0 + 25 * MIN)
    assert.equal(Model.remaining(s, T0), 25 * MIN)
  })

  test("start does not mutate its input", () => {
    const idle = Model.initialState()
    Model.start(idle, cfg(), T0)
    assert.equal(idle.phase, "idle")
  })

  test("pause freezes the remaining time", () => {
    const running = Model.start(Model.initialState(), cfg(), T0)
    const paused = Model.pause(running, T0 + 5 * MIN)
    assert.equal(paused.running, false)
    assert.equal(paused.phase, "work")
    assert.equal(Model.remaining(paused, T0 + 60 * MIN), 20 * MIN)
  })

  test("resume continues from the frozen remaining time", () => {
    const paused = Model.pause(Model.start(Model.initialState(), cfg(), T0), T0 + 5 * MIN)
    const resumed = Model.resume(paused, T0 + 30 * MIN)
    assert.equal(resumed.running, true)
    assert.equal(resumed.endsAt, T0 + 50 * MIN)
  })

  test("toggle starts, pauses, and resumes", () => {
    let s = Model.toggle(Model.initialState(), cfg(), T0)
    assert.equal(s.running, true)
    s = Model.toggle(s, cfg(), T0 + MIN)
    assert.equal(s.running, false)
    s = Model.toggle(s, cfg(), T0 + 2 * MIN)
    assert.equal(s.running, true)
    assert.equal(Model.remaining(s, T0 + 2 * MIN), 24 * MIN)
  })

  test("pause is a no-op when not running", () => {
    const idle = Model.initialState()
    assert.deepEqual(plain(Model.pause(idle, T0)), plain(idle))
  })

  test("remaining is never negative", () => {
    const s = Model.start(Model.initialState(), cfg(), T0)
    assert.equal(Model.remaining(s, T0 + 99 * MIN), 0)
  })
})

describe("tick and the awaiting-confirmation state", () => {
  test("tick before the end changes nothing", () => {
    const s = Model.start(Model.initialState(), cfg(), T0)
    assert.deepEqual(plain(Model.tick(s, cfg(), T0 + MIN)), plain(s))
  })

  test("a finished work phase awaits confirmation for a short break", () => {
    const s = finishPhase(Model.start(Model.initialState(), cfg(), T0), cfg(), T0)
    assert.equal(s.phase, "awaiting")
    assert.equal(s.running, false)
    assert.equal(s.finished, "work")
    assert.equal(s.next, "short")
    assert.equal(s.completed, 1)
  })

  test("the next phase never starts by itself", () => {
    const awaiting = finishPhase(Model.start(Model.initialState(), cfg(), T0), cfg(), T0)
    assert.deepEqual(plain(Model.tick(awaiting, cfg(), T0 + 999 * MIN)), plain(awaiting))
  })

  test("a paused phase does not finish while time passes", () => {
    const paused = Model.pause(Model.start(Model.initialState(), cfg(), T0), T0 + MIN)
    assert.equal(Model.tick(paused, cfg(), T0 + 999 * MIN).phase, "work")
  })

  test("confirm starts the pending break", () => {
    const awaiting = finishPhase(Model.start(Model.initialState(), cfg(), T0), cfg(), T0)
    const s = Model.confirm(awaiting, cfg(), T0 + 30 * MIN)
    assert.equal(s.phase, "short")
    assert.equal(s.running, true)
    assert.equal(s.endsAt, T0 + 35 * MIN)
  })

  test("a finished break awaits confirmation for work", () => {
    let s = finishPhase(Model.start(Model.initialState(), cfg(), T0), cfg(), T0)
    s = finishPhase(Model.confirm(s, cfg(), T0 + 25 * MIN), cfg(), T0)
    assert.equal(s.phase, "awaiting")
    assert.equal(s.finished, "short")
    assert.equal(s.next, "work")
    assert.equal(s.completed, 1)
  })

  test("toggle while awaiting confirms", () => {
    const awaiting = finishPhase(Model.start(Model.initialState(), cfg(), T0), cfg(), T0)
    assert.equal(Model.toggle(awaiting, cfg(), T0).phase, "short")
  })

  test("confirm outside awaiting/idle is a no-op", () => {
    const running = Model.start(Model.initialState(), cfg(), T0)
    assert.deepEqual(plain(Model.confirm(running, cfg(), T0 + MIN)), plain(running))
  })

  test("isTransition detects only the moment a phase ends", () => {
    const running = Model.start(Model.initialState(), cfg(), T0)
    const awaiting = finishPhase(running, cfg(), T0)
    assert.equal(Model.isTransition(running, awaiting), true)
    assert.equal(Model.isTransition(awaiting, awaiting), false)
    assert.equal(Model.isTransition(running, running), false)
  })
})

describe("long breaks", () => {
  function runCycle(config, works) {
    let s = Model.initialState()
    let now = T0
    const breaks = []
    for (let i = 0; i < works; i++) {
      s = Model.confirm(s, config, now)        // start work
      s = finishPhase(s, config, now)           // work done
      breaks.push(s.next)
      s = Model.confirm(s, config, now)         // start break
      s = finishPhase(s, config, now)           // break done
    }
    return breaks
  }

  test("every 4th work session earns a long break", () => {
    assert.deepEqual(runCycle(cfg(), 8), ["short", "short", "short", "long", "short", "short", "short", "long"])
  })

  test("sessionsBeforeLongBreak is configurable", () => {
    const c = Model.normalizeConfig({ sessionsBeforeLongBreak: 2 })
    assert.deepEqual(runCycle(c, 4), ["short", "long", "short", "long"])
  })

  test("a long break uses the long duration", () => {
    const c = Model.normalizeConfig({ sessionsBeforeLongBreak: 1 })
    const awaiting = finishPhase(Model.start(Model.initialState(), c, T0), c, T0)
    assert.equal(awaiting.next, "long")
    assert.equal(Model.confirm(awaiting, c, T0).endsAt, T0 + 15 * MIN)
  })
})

describe("skip", () => {
  test("skipping a running work phase ends it now and counts it", () => {
    const s = Model.skip(Model.start(Model.initialState(), cfg(), T0), cfg(), T0 + MIN)
    assert.equal(s.phase, "awaiting")
    assert.equal(s.finished, "work")
    assert.equal(s.next, "short")
    assert.equal(s.completed, 1)
  })

  test("skipping a paused phase also ends it", () => {
    const paused = Model.pause(Model.start(Model.initialState(), cfg(), T0), T0 + MIN)
    assert.equal(Model.skip(paused, cfg(), T0 + 2 * MIN).phase, "awaiting")
  })

  test("skip while awaiting a break goes straight to work", () => {
    const awaiting = finishPhase(Model.start(Model.initialState(), cfg(), T0), cfg(), T0)
    const s = Model.skip(awaiting, cfg(), T0 + 30 * MIN)
    assert.equal(s.phase, "work")
    assert.equal(s.running, true)
    assert.equal(s.endsAt, T0 + 55 * MIN)
  })

  test("skip while awaiting work is a no-op", () => {
    let s = finishPhase(Model.start(Model.initialState(), cfg(), T0), cfg(), T0)
    s = Model.skip(Model.confirm(s, cfg(), T0), cfg(), T0 + MIN)  // break skipped → awaiting work
    assert.equal(s.next, "work")
    assert.deepEqual(plain(Model.skip(s, cfg(), T0 + 2 * MIN)), plain(s))
  })

  test("skip while idle is a no-op", () => {
    assert.equal(Model.skip(Model.initialState(), cfg(), T0).phase, "idle")
  })
})

describe("reset", () => {
  test("reset returns to idle and clears the session count", () => {
    const awaiting = finishPhase(Model.start(Model.initialState(), cfg(), T0), cfg(), T0)
    assert.equal(awaiting.completed, 1)
    assert.deepEqual(plain(Model.reset()), plain(Model.initialState()))
  })
})

describe("adjust", () => {
  test("adds minutes to a running phase", () => {
    const s = Model.adjust(Model.start(Model.initialState(), cfg(), T0), T0, 1)
    assert.equal(s.endsAt, T0 + 26 * MIN)
  })

  test("removes minutes from a paused phase", () => {
    const paused = Model.pause(Model.start(Model.initialState(), cfg(), T0), T0)
    assert.equal(Model.remaining(Model.adjust(paused, T0, -1), T0), 24 * MIN)
  })

  test("never shrinks below one minute remaining", () => {
    const s = Model.start(Model.initialState(), cfg(), T0)
    const now = T0 + 24 * MIN + 30000
    assert.equal(Model.remaining(Model.adjust(s, now, -1), now), MIN)
  })

  test("does nothing while idle or awaiting", () => {
    const idle = Model.initialState()
    assert.deepEqual(plain(Model.adjust(idle, T0, 1)), plain(idle))
    const awaiting = finishPhase(Model.start(idle, cfg(), T0), cfg(), T0)
    assert.deepEqual(plain(Model.adjust(awaiting, T0, 1)), plain(awaiting))
  })
})

describe("formatRemaining", () => {
  test("formats MM:SS rounding seconds up", () => {
    assert.equal(Model.formatRemaining(25 * MIN), "25:00")
    assert.equal(Model.formatRemaining(61001), "01:02")
    assert.equal(Model.formatRemaining(999), "00:01")
    assert.equal(Model.formatRemaining(0), "00:00")
  })

  test("keeps counting minutes past an hour", () => {
    assert.equal(Model.formatRemaining(90 * MIN), "90:00")
  })

  test("treats negative or invalid input as zero", () => {
    assert.equal(Model.formatRemaining(-5), "00:00")
    assert.equal(Model.formatRemaining(NaN), "00:00")
  })
})

describe("persistence", () => {
  test("serialize and restore round-trip a running phase", () => {
    const s = Model.start(Model.initialState(), cfg(), T0)
    assert.deepEqual(plain(Model.restore(Model.serialize(s))), plain(s))
  })

  test("restore rejects garbage and falls back to idle", () => {
    for (const raw of ["", "not json", "null", "[]", '{"phase":"party"}', '{"phase":"work","running":true,"endsAt":"soon"}']) {
      assert.deepEqual(plain(Model.restore(raw)), plain(Model.initialState()), raw)
    }
  })

  test("a phase that ended while the shell was down finishes on the next tick", () => {
    const restored = Model.restore(Model.serialize(Model.start(Model.initialState(), cfg(), T0)))
    const ticked = Model.tick(restored, cfg(), T0 + 60 * MIN)
    assert.equal(Model.isTransition(restored, ticked), true)
    assert.equal(ticked.phase, "awaiting")
  })

  test("a restored awaiting state is not a new transition", () => {
    const awaiting = finishPhase(Model.start(Model.initialState(), cfg(), T0), cfg(), T0)
    const restored = Model.restore(Model.serialize(awaiting))
    assert.equal(restored.phase, "awaiting")
    assert.equal(Model.isTransition(restored, Model.tick(restored, cfg(), T0 + MIN)), false)
  })
})

describe("labels", () => {
  test("notification text for a finished work session", () => {
    const awaiting = finishPhase(Model.start(Model.initialState(), cfg(), T0), cfg(), T0)
    assert.deepEqual(plain(Model.notification(awaiting, cfg())), {
      summary: "Work session done",
      body: "Click to start a 5 min short break",
    })
  })

  test("notification text for a long break and for a finished break", () => {
    const c = Model.normalizeConfig({ sessionsBeforeLongBreak: 1 })
    let s = finishPhase(Model.start(Model.initialState(), c, T0), c, T0)
    assert.equal(Model.notification(s, c).body, "Click to start a 15 min long break")
    s = finishPhase(Model.confirm(s, c, T0), c, T0)
    assert.deepEqual(plain(Model.notification(s, c)), {
      summary: "Break over",
      body: "Click to start a 25 min work session",
    })
  })

  test("bar text while paused still shows the frozen time", () => {
    const paused = Model.pause(Model.start(Model.initialState(), cfg(), T0), T0 + 5 * MIN)
    assert.equal(Model.barText(paused, T0 + 60 * MIN), "20:00")
  })

  test("bar text per state", () => {
    const c = cfg()
    assert.equal(Model.barText(Model.initialState(), T0), "")
    const running = Model.start(Model.initialState(), c, T0)
    assert.equal(Model.barText(running, T0 + 1000), "24:59")
    const awaiting = finishPhase(running, c, T0)
    assert.equal(Model.barText(awaiting, T0), "Break?")
    const toWork = finishPhase(Model.confirm(awaiting, c, T0), c, T0)
    assert.equal(Model.barText(toWork, T0), "Work?")
  })
})

describe("widget presentation", () => {
  const c = cfg()
  const idle = () => Model.initialState()
  const running = () => Model.start(idle(), c, T0)
  const awaitingShort = () => finishPhase(running(), c, T0)

  test("icon per state", () => {
    assert.equal(Model.icon(idle()), "\u{F051B}")
    assert.equal(Model.icon(running()), "\u{F051F}")
    assert.equal(Model.icon(Model.pause(running(), T0)), "\u{F03E4}")
    assert.equal(Model.icon(awaitingShort()), "\u{F009E}")
    assert.equal(Model.icon(Model.confirm(awaitingShort(), c, T0)), "\u{F0176}")
    const c1 = Model.normalizeConfig({ sessionsBeforeLongBreak: 1 })
    const longBreak = Model.confirm(finishPhase(Model.start(idle(), c1, T0), c1, T0), c1, T0)
    assert.equal(longBreak.phase, "long")
    assert.equal(Model.icon(longBreak), "\u{F04B2}")
  })

  test("only the awaiting state is urgent", () => {
    assert.equal(Model.isUrgent(idle()), false)
    assert.equal(Model.isUrgent(running()), false)
    assert.equal(Model.isUrgent(awaitingShort()), true)
  })

  test("session dots fill as work sessions complete", () => {
    assert.equal(Model.sessionDots(idle(), c), "○○○○")
    assert.equal(Model.sessionDots(awaitingShort(), c), "●○○○")
  })

  test("session dots stay full through the long break, then empty", () => {
    let s = idle()
    for (let i = 0; i < 4; i++) {
      s = finishPhase(Model.confirm(s, c, T0), c, T0)   // work done
      if (i < 3) s = finishPhase(Model.confirm(s, c, T0), c, T0)  // short break done
    }
    assert.equal(s.next, "long")
    assert.equal(Model.sessionDots(s, c), "●●●●")
    s = Model.confirm(s, c, T0)
    assert.equal(Model.sessionDots(s, c), "●●●●")
    s = finishPhase(s, c, T0)
    assert.equal(Model.sessionDots(s, c), "○○○○")
  })

  test("tooltip while idle points at the popup, with no click hints", () => {
    assert.equal(Model.tooltip(idle(), c, T0), "Pomarchy\nClick to open the timer · 25 min work sessions")
  })

  test("tooltip while running shows time left and progress", () => {
    assert.equal(Model.tooltip(running(), c, T0 + 1000), "Work session · 24:59 left\n○○○○")
  })

  test("tooltip while paused says so", () => {
    const paused = Model.pause(running(), T0 + 5 * MIN)
    assert.equal(Model.tooltip(paused, c, T0 + 60 * MIN), "Work session · paused · 20:00 left\n○○○○")
  })

  test("tooltip while awaiting repeats the confirmation prompt", () => {
    assert.equal(Model.tooltip(awaitingShort(), c, T0), "Work session done\nClick to start a 5 min short break\n●○○○")
  })
})

describe("phase-change alerts", () => {
  const c = cfg()
  const awaitingShort = () => finishPhase(Model.start(Model.initialState(), c, T0), c, T0)
  const awaitingWork = () => finishPhase(Model.confirm(awaitingShort(), c, T0), c, T0)

  test("notification is a sticky, clickable prompt that reports its id", () => {
    assert.deepEqual(plain(Model.notifyCommand(awaitingShort(), c)), [
      "notify-send", "--app-name=Pomarchy", "--urgency=critical", "--print-id",
      "--action=default=Start short break", "Work session done", "Click to start a 5 min short break",
    ])
  })

  test("notification action names the next phase", () => {
    assert.ok(Model.notifyCommand(awaitingWork(), c).includes("--action=default=Start work session"))
  })

  test("no notification when disabled or not awaiting", () => {
    const off = Model.normalizeConfig({ notify: false })
    assert.deepEqual(plain(Model.notifyCommand(awaitingShort(), off)), [])
    assert.deepEqual(plain(Model.notifyCommand(Model.initialState(), c)), [])
  })

  test("sound plays the configured file through pipewire", () => {
    assert.deepEqual(plain(Model.soundCommand(c)), ["pw-play", Model.DEFAULT_SOUND])
    assert.deepEqual(plain(Model.soundCommand(Model.normalizeConfig({ sound: "" }))), [])
  })

  test("parses the id line, then the clicked action", () => {
    assert.deepEqual(plain(Model.parseNotifyLine("17", false)), { id: 17 })
    assert.deepEqual(plain(Model.parseNotifyLine("default", true)), { action: "default" })
    assert.deepEqual(plain(Model.parseNotifyLine("  default \n", true)), { action: "default" })
  })

  test("ignores blank lines and non-numeric ids", () => {
    assert.equal(Model.parseNotifyLine("", false), null)
    assert.equal(Model.parseNotifyLine("   ", true), null)
    assert.equal(Model.parseNotifyLine("default", false), null)
    assert.equal(Model.parseNotifyLine("0", false), null)
  })

  test("closes a notification by id over D-Bus", () => {
    assert.deepEqual(plain(Model.closeNotificationCommand(17)), [
      "gdbus", "call", "--session", "--dest", "org.freedesktop.Notifications",
      "--object-path", "/org/freedesktop/Notifications",
      "--method", "org.freedesktop.Notifications.CloseNotification", "17",
    ])
    assert.deepEqual(plain(Model.closeNotificationCommand(0)), [])
    assert.deepEqual(plain(Model.closeNotificationCommand(-3)), [])
  })

  test("a notification click confirms only a pending phase change", () => {
    assert.equal(Model.confirmPending(awaitingShort(), c, T0).phase, "short")
    // A stale click after a reset must not start a new work session.
    assert.equal(Model.confirmPending(Model.initialState(), c, T0).phase, "idle")
    const running = Model.start(Model.initialState(), c, T0)
    assert.deepEqual(plain(Model.confirmPending(running, c, T0)), plain(running))
  })
})

describe("state file", () => {
  test("lives under XDG_STATE_HOME when it is set", () => {
    assert.equal(Model.stateDir({ XDG_STATE_HOME: "/x/state", HOME: "/home/u" }), "/x/state/pomarchy")
    assert.equal(Model.stateDir({ XDG_STATE_HOME: "/x/state/", HOME: "/home/u" }), "/x/state/pomarchy")
  })

  test("falls back to ~/.local/state", () => {
    assert.equal(Model.stateDir({ XDG_STATE_HOME: "", HOME: "/home/u" }), "/home/u/.local/state/pomarchy")
    assert.equal(Model.stateDir({ HOME: "/home/u" }), "/home/u/.local/state/pomarchy")
  })

  test("the hot-reload copy wins over the file (it is never older)", () => {
    assert.equal(Model.pickSaved('{"a":1}', '{"b":2}'), '{"a":1}')
  })

  test("the file is used after a shell restart", () => {
    assert.equal(Model.pickSaved("", '{"b":2}'), '{"b":2}')
    assert.equal(Model.pickSaved("", ""), "")
    assert.equal(Model.pickSaved(undefined, null), "")
  })

  test("a timer saved by one shell resumes in the next", () => {
    const running = Model.start(Model.initialState(), cfg(), T0)
    const resumed = Model.restore(Model.pickSaved("", Model.serialize(running) + "\n"))
    assert.equal(Model.remaining(resumed, T0 + 10 * MIN), 15 * MIN)
  })
})

describe("status for scripts", () => {
  const c = cfg()

  test("idle", () => {
    assert.deepEqual(plain(Model.status(Model.initialState(), c, T0)), {
      phase: "idle", running: false, paused: false, awaiting: false,
      remainingMs: 0, display: "", next: "work", completed: 0,
    })
  })

  test("running work session", () => {
    const s = Model.start(Model.initialState(), c, T0)
    assert.deepEqual(plain(Model.status(s, c, T0 + 1000)), {
      phase: "work", running: true, paused: false, awaiting: false,
      remainingMs: 25 * MIN - 1000, display: "24:59", next: "", completed: 0,
    })
  })

  test("paused session reports paused", () => {
    const s = Model.pause(Model.start(Model.initialState(), c, T0), T0 + MIN)
    const st = Model.status(s, c, T0 + 5 * MIN)
    assert.equal(st.paused, true)
    assert.equal(st.running, false)
    assert.equal(st.remainingMs, 24 * MIN)
  })

  test("awaiting confirmation names the next phase", () => {
    const s = finishPhase(Model.start(Model.initialState(), c, T0), c, T0)
    const st = Model.status(s, c, T0)
    assert.equal(st.awaiting, true)
    assert.equal(st.next, "short")
    assert.equal(st.display, "Break?")
    assert.equal(st.completed, 1)
  })
})

describe("review fixes", () => {
  const c = cfg()

  test("isPaused is true only for a stopped timed phase", () => {
    const running = Model.start(Model.initialState(), c, T0)
    assert.equal(Model.isPaused(Model.initialState()), false)
    assert.equal(Model.isPaused(running), false)
    assert.equal(Model.isPaused(Model.pause(running, T0)), true)
    assert.equal(Model.isPaused(finishPhase(running, c, T0)), false)
  })

  test("status.paused agrees with isPaused", () => {
    const paused = Model.pause(Model.start(Model.initialState(), c, T0), T0)
    assert.equal(Model.status(paused, c, T0).paused, Model.isPaused(paused))
  })

  test("a popup closing clears the tracked id only if it is still the current one", () => {
    assert.equal(Model.notificationClosed(7, 7), 0)
    // An older notify-send exiting late must not forget the newer popup.
    assert.equal(Model.notificationClosed(9, 7), 9)
    assert.equal(Model.notificationClosed(0, 7), 0)
    assert.equal(Model.notificationClosed(7, 0), 7)
  })

  test("only the current popup's click counts", () => {
    assert.equal(Model.isCurrentNotification(7, 7), true)
    assert.equal(Model.isCurrentNotification(9, 7), false)
    assert.equal(Model.isCurrentNotification(0, 0), false)
  })
})

// ---- Popup panel

const SEC = 1000
// Local midnight of the day T0 falls on; the suite runs with TZ=UTC, and the
// tests compute midnight with the same Date API as the model.
const midnightOf = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }

function workDone(state, config, now) {
  return finishPhase(Model.confirm(state, config, now), config, now)
}

describe("phase bookkeeping", () => {
  const c = cfg()

  test("begin records when the phase started and how long it is", () => {
    const s = Model.start(Model.initialState(), c, T0)
    assert.equal(s.startedAt, T0)
    assert.equal(s.durationMs, 25 * MIN)
  })

  test("adjust moves durationMs by the same amount as the end time", () => {
    const s = Model.adjust(Model.start(Model.initialState(), c, T0), T0, 2)
    assert.equal(s.durationMs, 27 * MIN)
    const clamped = Model.adjust(Model.start(Model.initialState(), c, T0), T0 + 24 * MIN, -5)
    assert.equal(Model.remaining(clamped, T0 + 24 * MIN), MIN)
    assert.equal(clamped.durationMs, 25 * MIN)  // 1 min left was already the floor
  })

  test("a finished work session counts toward the cycle", () => {
    const s = finishPhase(Model.start(Model.initialState(), c, T0), c, T0)
    assert.equal(s.cycle, 1)
    assert.equal(s.completed, 1)
  })

  test("a natural end is recorded at endsAt", () => {
    const s = Model.tick(Model.start(Model.initialState(), c, T0), c, T0 + 30 * MIN)
    assert.deepEqual(plain(s.history), [{ phase: "work", startedAt: T0, endedAt: T0 + 25 * MIN, ms: 25 * MIN }])
  })

  test("a skip is recorded at the moment of skipping, with the time actually spent", () => {
    const s = Model.skip(Model.start(Model.initialState(), c, T0), c, T0 + 10 * MIN)
    assert.deepEqual(plain(s.history), [{ phase: "work", startedAt: T0, endedAt: T0 + 10 * MIN, ms: 10 * MIN }])
  })

  test("paused time does not count as time spent", () => {
    let s = Model.pause(Model.start(Model.initialState(), c, T0), T0 + 5 * MIN)
    s = Model.resume(s, T0 + 20 * MIN)
    s = Model.skip(s, c, T0 + 25 * MIN)
    assert.equal(s.history[0].ms, 10 * MIN)
  })

  test("breaks are recorded but do not count as sessions", () => {
    let s = finishPhase(Model.start(Model.initialState(), c, T0), c, T0)
    s = finishPhase(Model.confirm(s, c, T0 + 25 * MIN), c, T0)
    assert.equal(s.completed, 1)
    assert.equal(s.cycle, 1)
    assert.deepEqual(plain(s.history.map((h) => h.phase)), ["work", "short"])
  })
})

describe("long break after N cycles", () => {
  function breaksAfter(works, configs) {
    let s = Model.initialState()
    const out = []
    for (let i = 0; i < works; i++) {
      const config = configs(i)
      s = workDone(s, config, T0)
      out.push(s.next)
      s = finishPhase(Model.confirm(s, config, T0), config, T0)
    }
    return out
  }

  test("N = 4: short, short, short, long", () => {
    assert.deepEqual(breaksAfter(4, () => cfg()), ["short", "short", "short", "long"])
  })

  test("the cycle restarts once the long break is over", () => {
    let s = Model.initialState()
    for (let i = 0; i < 4; i++) {
      s = workDone(s, cfg(), T0)
      if (i < 3) s = finishPhase(Model.confirm(s, cfg(), T0), cfg(), T0)
    }
    s = Model.confirm(s, cfg(), T0)
    assert.equal(s.phase, "long")
    s = finishPhase(s, cfg(), T0)
    assert.equal(s.cycle, 0)
    assert.equal(s.completed, 4)
  })

  test("raising N mid-cycle never gives a long break after one session of the new cycle", () => {
    // 5 sessions at N = 4, then N = 3: the 6th gives a short break, the 7th the long one.
    const c4 = cfg()
    const c3 = Model.normalizeConfig({ sessionsBeforeLongBreak: 3 })
    assert.deepEqual(breaksAfter(7, (i) => (i < 5 ? c4 : c3)),
      ["short", "short", "short", "long", "short", "short", "long"])
  })

  test("lowering N below the current cycle earns the long break on the next session", () => {
    const c2 = Model.normalizeConfig({ sessionsBeforeLongBreak: 2 })
    assert.deepEqual(breaksAfter(4, (i) => (i < 3 ? cfg() : c2)), ["short", "short", "short", "long"])
    // cycle was 3 at N = 4; N = 2 now → the 4th session is long either way, so check the 3rd:
    assert.deepEqual(breaksAfter(3, (i) => (i < 2 ? cfg() : c2)), ["short", "short", "long"])
  })

  test("skipping an earned long break still starts a new cycle", () => {
    const c1 = Model.normalizeConfig({ sessionsBeforeLongBreak: 1 })
    let s = workDone(Model.initialState(), c1, T0)
    assert.equal(s.next, "long")
    s = Model.skip(s, c1, T0)
    assert.equal(s.phase, "work")
    assert.equal(s.cycle, 0)
  })

  test("session dots follow the cycle and never overflow when N shrinks", () => {
    let s = Model.initialState()
    for (let i = 0; i < 3; i++) s = finishPhase(Model.confirm(workDone(s, cfg(), T0), cfg(), T0), cfg(), T0)
    assert.equal(Model.sessionDots(s, cfg()), "●●●○")
    assert.equal(Model.sessionDots(s, Model.normalizeConfig({ sessionsBeforeLongBreak: 2 })), "●●")
  })
})

describe("history", () => {
  const entry = (endedAt, phase = "work") => ({ phase, startedAt: endedAt - 25 * MIN, endedAt, ms: 25 * MIN })

  test("pruneHistory keeps only entries that ended since local midnight", () => {
    const now = midnightOf(T0) + 10 * 60 * MIN
    const kept = Model.pruneHistory([entry(midnightOf(T0) - MIN), entry(midnightOf(T0) + MIN)], now)
    assert.deepEqual(plain(kept), [entry(midnightOf(T0) + MIN)])
  })

  test("pruneHistory caps the list at the 50 newest entries", () => {
    const now = midnightOf(T0) + 20 * 60 * MIN
    const many = Array.from({ length: 60 }, (_, i) => entry(midnightOf(T0) + (i + 1) * MIN))
    const kept = Model.pruneHistory(many, now)
    assert.equal(kept.length, 50)
    assert.equal(kept[49].endedAt, many[59].endedAt)
    assert.equal(kept[0].endedAt, many[10].endedAt)
  })

  test("finishing a phase drops yesterday's entries", () => {
    const today = midnightOf(T0) + 12 * 60 * MIN
    const s = Model.start(Model.initialState(), cfg(), today)
    s.history = [entry(midnightOf(T0) - 60 * MIN)]
    const done = Model.skip(s, cfg(), today + MIN)
    assert.deepEqual(plain(done.history.map((h) => h.endedAt)), [today + MIN])
  })

  test("the input history is never mutated", () => {
    const s = Model.start(Model.initialState(), cfg(), T0)
    const before = s.history
    Model.skip(s, cfg(), T0 + MIN)
    assert.equal(before.length, 0)
  })
})

describe("restore with the new fields", () => {
  const OLD = { phase: "work", running: true, endsAt: T0 + 10 * MIN, remainingMs: 0, completed: 6, next: "", finished: "" }

  test("round-trips cycle, durationMs, startedAt and history", () => {
    const s = Model.skip(Model.start(Model.initialState(), cfg(), T0), cfg(), T0 + MIN)
    assert.deepEqual(plain(Model.restore(Model.serialize(s), cfg(), T0 + MIN)), plain(s))
  })

  test("an old state file migrates instead of resetting", () => {
    const s = Model.restore(JSON.stringify(OLD), cfg(), T0)
    assert.equal(s.phase, "work")
    assert.equal(s.cycle, 2)            // 6 % 4
    assert.equal(s.durationMs, 25 * MIN)
    assert.equal(s.startedAt, 0)
    assert.deepEqual(plain(s.history), [])
  })

  test("an old file without a config still restores", () => {
    assert.equal(Model.restore(JSON.stringify(OLD)).durationMs, 25 * MIN)
  })

  test("an old file pending a long break keeps the cycle full", () => {
    const old = { ...OLD, phase: "awaiting", running: false, endsAt: 0, completed: 4, next: "long", finished: "work" }
    assert.equal(Model.restore(JSON.stringify(old), cfg(), T0).cycle, 4)
  })

  test("malformed new fields fall back to idle", () => {
    for (const bad of [{ cycle: -1 }, { cycle: "2" }, { durationMs: "x" }, { startedAt: -5 }, { history: "nope" }]) {
      assert.deepEqual(plain(Model.restore(JSON.stringify({ ...OLD, ...bad }), cfg(), T0)), plain(Model.initialState()), JSON.stringify(bad))
    }
  })

  test("invalid history entries are dropped, and yesterday is pruned on restore", () => {
    const now = midnightOf(T0) + 12 * 60 * MIN
    const good = { phase: "work", startedAt: now - 30 * MIN, endedAt: now - 5 * MIN, ms: 25 * MIN }
    const old = { phase: "work", startedAt: 1, endedAt: midnightOf(T0) - MIN, ms: 25 * MIN }
    const history = [good, old, { phase: "party", startedAt: 1, endedAt: now, ms: 1 }, null, { phase: "short" }]
    const s = Model.restore(JSON.stringify({ ...OLD, history }), cfg(), now)
    assert.deepEqual(plain(s.history), [good])
  })
})

describe("back", () => {
  const c = cfg()

  test("does nothing while idle", () => {
    assert.deepEqual(plain(Model.back(Model.initialState(), c, T0)), plain(Model.initialState()))
  })

  test("more than 5 s into a phase restarts it at full length, running", () => {
    const paused = Model.pause(Model.start(Model.initialState(), c, T0), T0 + 10 * MIN)
    const s = Model.back(paused, c, T0 + 20 * MIN)
    assert.equal(s.phase, "work")
    assert.equal(s.running, true)
    assert.equal(Model.remaining(s, T0 + 20 * MIN), 25 * MIN)
    assert.equal(s.startedAt, T0 + 20 * MIN)
  })

  test("in the first 5 s of the first work session it just restarts work", () => {
    const s = Model.back(Model.start(Model.initialState(), c, T0), c, T0 + 3 * SEC)
    assert.equal(s.phase, "work")
    assert.equal(s.endsAt, T0 + 3 * SEC + 25 * MIN)
  })

  test("in the first 5 s of a work session it goes back to the break before it", () => {
    let s = workDone(Model.initialState(), c, T0)
    s = finishPhase(Model.confirm(s, c, T0), c, T0)      // short break done
    s = Model.confirm(s, c, T0 + 30 * MIN)               // work #2
    const back = Model.back(s, c, T0 + 30 * MIN + 2 * SEC)
    assert.equal(back.phase, "short")
    assert.equal(back.running, true)
    assert.equal(back.completed, 1)
    assert.deepEqual(plain(back.history.map((h) => h.phase)), ["work"])  // the redone break's entry is gone
  })

  test("after a long break, back from work goes to the long break again", () => {
    const c1 = Model.normalizeConfig({ sessionsBeforeLongBreak: 1 })
    let s = workDone(Model.initialState(), c1, T0)
    s = finishPhase(Model.confirm(s, c1, T0), c1, T0)    // long break done
    s = Model.confirm(s, c1, T0)                         // work
    const back = Model.back(s, c1, T0 + SEC)
    assert.equal(back.phase, "long")
    assert.equal(Model.sessionDots(back, c1), "●")
  })

  test("in the first 5 s of a break it redoes the work session that just ended", () => {
    let s = workDone(Model.initialState(), c, T0)
    s = Model.confirm(s, c, T0 + 25 * MIN)
    const back = Model.back(s, c, T0 + 25 * MIN + 4 * SEC)
    assert.equal(back.phase, "work")
    assert.equal(back.running, true)
    assert.equal(back.completed, 0)
    assert.equal(back.cycle, 0)
    assert.deepEqual(plain(back.history), [])
  })

  test("back from a long break restores the cycle it consumed", () => {
    const c1 = Model.normalizeConfig({ sessionsBeforeLongBreak: 1 })
    const s = Model.confirm(workDone(Model.initialState(), c1, T0), c1, T0)
    const back = Model.back(s, c1, T0 + SEC)
    assert.equal(back.phase, "work")
    assert.equal(back.cycle, 0)
    assert.equal(workDone(Model.stop(back), c1, T0).next, "long")
  })

  test("while awaiting a break it redoes the work session that just ended", () => {
    const back = Model.back(workDone(Model.initialState(), c, T0), c, T0 + 99 * MIN)
    assert.equal(back.phase, "work")
    assert.equal(back.completed, 0)
    assert.deepEqual(plain(back.history), [])
  })

  test("while awaiting work it replays the break that just ended", () => {
    let s = workDone(Model.initialState(), c, T0)
    s = finishPhase(Model.confirm(s, c, T0), c, T0)
    const back = Model.back(s, c, T0 + 99 * MIN)
    assert.equal(back.phase, "short")
    assert.equal(back.completed, 1)
    assert.deepEqual(plain(back.history.map((h) => h.phase)), ["work"])
  })
})

describe("stop", () => {
  const c = cfg()

  test("returns to idle without counting the stopped phase", () => {
    const s = Model.stop(Model.start(Model.initialState(), c, T0))
    assert.equal(s.phase, "idle")
    assert.equal(s.running, false)
    assert.equal(s.next, "work")
    assert.equal(s.completed, 0)
    assert.deepEqual(plain(s.history), [])
  })

  test("keeps cycle progress and history, so play continues the cycle", () => {
    let s = workDone(Model.initialState(), c, T0)
    s = Model.stop(Model.confirm(s, c, T0))
    assert.equal(s.cycle, 1)
    assert.equal(s.history.length, 1)
    s = Model.toggle(s, c, T0 + MIN)
    assert.equal(s.phase, "work")
    assert.equal(s.endsAt, T0 + 26 * MIN)
  })

  test("stops while awaiting too", () => {
    assert.equal(Model.stop(workDone(Model.initialState(), c, T0)).phase, "idle")
  })

  test("is a no-op while idle", () => {
    const idle = Model.initialState()
    assert.equal(Model.stop(idle), idle)
  })
})

describe("next", () => {
  const c = cfg()

  test("ends a timed phase and counts it, like skip", () => {
    const s = Model.next(Model.start(Model.initialState(), c, T0), c, T0 + MIN)
    assert.equal(s.phase, "awaiting")
    assert.equal(s.completed, 1)
  })

  test("while awaiting a break it skips the break and starts work", () => {
    assert.equal(Model.next(workDone(Model.initialState(), c, T0), c, T0).phase, "work")
  })

  test("while awaiting work it starts the work session", () => {
    let s = workDone(Model.initialState(), c, T0)
    s = finishPhase(Model.confirm(s, c, T0), c, T0)
    s = Model.next(s, c, T0 + MIN)
    assert.equal(s.phase, "work")
    assert.equal(s.running, true)
  })

  test("does nothing while idle", () => {
    assert.equal(Model.next(Model.initialState(), c, T0).phase, "idle")
  })
})

describe("panelView", () => {
  const c = cfg()

  test("idle shows the next work session at full length with an empty ring", () => {
    assert.deepEqual(plain(Model.panelView(Model.initialState(), c, T0)), {
      title: "Work session next", display: "25:00", progress: 0,
      playing: false, paused: false, urgent: false,
      canBack: false, canNext: false, canStop: false,
      dots: "○○○○", history: [],
    })
  })

  test("running shows the time left and how much has elapsed", () => {
    const v = Model.panelView(Model.start(Model.initialState(), c, T0), c, T0 + 5 * MIN)
    assert.equal(v.title, "Work session")
    assert.equal(v.display, "20:00")
    assert.equal(v.progress, 0.2)
    assert.equal(v.playing, true)
    assert.equal(v.canBack && v.canNext && v.canStop, true)
  })

  test("paused says so and freezes the ring", () => {
    const paused = Model.pause(Model.start(Model.initialState(), c, T0), T0 + 5 * MIN)
    const v = Model.panelView(paused, c, T0 + 50 * MIN)
    assert.equal(v.title, "Work session · paused")
    assert.equal(v.paused, true)
    assert.equal(v.playing, false)
    assert.equal(v.progress, 0.2)
  })

  test("awaiting names the next phase at full length, urgent", () => {
    const v = Model.panelView(workDone(Model.initialState(), c, T0), c, T0)
    assert.equal(v.title, "Short break next")
    assert.equal(v.display, "05:00")
    assert.equal(v.progress, 0)
    assert.equal(v.urgent, true)
    assert.equal(v.canNext, true)
    assert.equal(v.dots, "●○○○")
  })

  test("idle and awaiting follow a duration change at once", () => {
    assert.equal(Model.panelView(Model.initialState(), Model.normalizeConfig({ workMinutes: 45 }), T0).display, "45:00")
  })

  test("a running phase keeps its own length after a duration change", () => {
    const s = Model.start(Model.initialState(), c, T0)
    const v = Model.panelView(s, Model.normalizeConfig({ workMinutes: 60 }), T0 + 5 * MIN)
    assert.equal(v.progress, 0.2)
  })

  test("progress stays within 0..1", () => {
    const s = Model.start(Model.initialState(), c, T0)
    assert.equal(Model.panelView(s, c, T0 + 99 * MIN).progress, 1)
    assert.equal(Model.panelView({ ...plain(s), durationMs: 0 }, c, T0).progress, 0)
  })

  test("today's sessions, newest first, with times and minutes", () => {
    const start = midnightOf(T0) + 9 * 60 * MIN + 12 * MIN   // 09:12 UTC
    let s = Model.tick(Model.start(Model.initialState(), c, start), c, start + 25 * MIN)
    s = Model.skip(Model.confirm(s, c, start + 26 * MIN), c, start + 29 * MIN)
    const v = Model.panelView(s, c, start + 30 * MIN)
    assert.deepEqual(plain(v.history), [
      { icon: Model.ICONS.short, label: "Short break", range: "09:38–09:41", minutes: 3 },
      { icon: Model.ICONS.work, label: "Work session", range: "09:12–09:37", minutes: 25 },
    ])
  })

  test("entries from before midnight disappear without a new phase ending", () => {
    const s = Model.tick(Model.start(Model.initialState(), c, T0), c, T0 + 25 * MIN)
    assert.deepEqual(plain(Model.panelView(s, c, midnightOf(T0) + 24 * 60 * MIN + MIN).history), [])
  })

  test("a history entry without a start time uses its length", () => {
    const s = Model.restore(JSON.stringify({ phase: "work", running: true, endsAt: T0 + 10 * MIN, remainingMs: 0, completed: 0, next: "", finished: "" }), c, T0)
    const done = Model.tick(s, c, T0 + 10 * MIN)
    assert.equal(done.history[0].startedAt, T0 + 10 * MIN - 25 * MIN)
  })
})

describe("settings helpers", () => {
  test("duration choices per setting", () => {
    assert.deepEqual(plain(Model.DURATION_CHOICES), {
      workMinutes: [15, 25, 45, 60],
      shortBreakMinutes: [3, 5, 10, 15],
      longBreakMinutes: [10, 15, 20, 30],
    })
  })

  test("chip options carry string values and minute labels", () => {
    assert.deepEqual(plain(Model.durationOptions("workMinutes")), [
      { value: "15", label: "15 min" }, { value: "25", label: "25 min" },
      { value: "45", label: "45 min" }, { value: "60", label: "60 min" },
    ])
    assert.deepEqual(plain(Model.durationOptions("nope")), [])
  })

  test("a configured value outside the choices highlights no chip and gets a note", () => {
    assert.equal(Model.chipValue("workMinutes", 25), "25")
    assert.equal(Model.chipValue("workMinutes", 50), "")
    assert.equal(Model.customNote("workMinutes", 50), "custom: 50 min")
    assert.equal(Model.customNote("workMinutes", 25), "")
  })

  test("settingsMinutes reads the current values back from the config", () => {
    assert.deepEqual(plain(Model.settingsMinutes(Model.normalizeConfig({ workMinutes: 50 }))), {
      workMinutes: 50, shortBreakMinutes: 5, longBreakMinutes: 15, sessionsBeforeLongBreak: 4,
    })
  })

  test("the cycles stepper stays within 1..12", () => {
    assert.equal(Model.stepCycles(4, 1), 5)
    assert.equal(Model.stepCycles(1, -1), 1)
    assert.equal(Model.stepCycles(12, 1), 12)
  })
})

// ---- Stats archive and contribution graph

const at = (key, hh = 12, mm = 0) => {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d, hh, mm).getTime()
}
const workEntry = (key, minutes = 25, hh = 9) => ({ phase: "work", startedAt: at(key, hh), endedAt: at(key, hh) + minutes * MIN, ms: minutes * MIN })
const statsOf = (days) => ({ version: 1, days })

describe("dayKey", () => {
  test("is the local calendar date, zero-padded", () => {
    assert.equal(Model.dayKey(at("2026-03-05", 0, 0)), "2026-03-05")
    assert.equal(Model.dayKey(at("2026-12-31", 23, 59)), "2026-12-31")
  })
})

describe("statsDelta", () => {
  const c = cfg()

  test("a finished work session adds one session and its minutes to its day", () => {
    const running = Model.start(Model.initialState(), c, at("2026-10-14", 9))
    const done = Model.skip(running, c, at("2026-10-14", 9, 20))
    assert.deepEqual(plain(Model.statsDelta(running, done, at("2026-10-14", 9, 20))),
      [{ day: "2026-10-14", sessions: 1, focusMs: 20 * MIN }])
  })

  test("breaks, pauses, stop and ordinary ticks add nothing", () => {
    const now = at("2026-10-14", 9)
    let s = Model.skip(Model.start(Model.initialState(), c, now), c, now + MIN)   // work done
    const brk = Model.confirm(s, c, now + MIN)
    const brkDone = Model.skip(brk, c, now + 2 * MIN)
    assert.deepEqual(plain(Model.statsDelta(brk, brkDone, now + 2 * MIN)), [])
    const running = Model.confirm(brkDone, c, now + 3 * MIN)
    assert.deepEqual(plain(Model.statsDelta(running, Model.pause(running, now + 4 * MIN), now + 4 * MIN)), [])
    assert.deepEqual(plain(Model.statsDelta(running, Model.stop(running), now + 4 * MIN)), [])
    assert.deepEqual(plain(Model.statsDelta(running, running, now + 4 * MIN)), [])
  })

  test("back redoing a work session takes its count back", () => {
    const now = at("2026-10-14", 9)
    const awaiting = Model.skip(Model.start(Model.initialState(), c, now), c, now + 25 * MIN)
    const redo = Model.back(awaiting, c, now + 26 * MIN)
    assert.deepEqual(plain(Model.statsDelta(awaiting, redo, now + 26 * MIN)),
      [{ day: "2026-10-14", sessions: -1, focusMs: -25 * MIN }])
  })

  test("reset clearing the day's list is not an undo", () => {
    const now = at("2026-10-14", 9)
    const awaiting = Model.skip(Model.start(Model.initialState(), c, now), c, now + 25 * MIN)
    assert.deepEqual(plain(Model.statsDelta(awaiting, Model.reset(), now + 26 * MIN)), [])
  })

  test("yesterday's entries pruned at midnight are not an undo", () => {
    const prev = { ...Model.initialState(), history: [workEntry("2026-10-13")] }
    const running = Model.start(prev, c, at("2026-10-14", 9))
    const done = Model.skip(running, c, at("2026-10-14", 9, 10))
    assert.deepEqual(plain(Model.statsDelta(running, done, at("2026-10-14", 9, 10))),
      [{ day: "2026-10-14", sessions: 1, focusMs: 10 * MIN }])
  })
})

describe("stats archive", () => {
  test("applyStatsDelta adds per day without mutating its input", () => {
    const before = statsOf({ "2026-10-14": { sessions: 1, focusMs: 25 * MIN } })
    const after = Model.applyStatsDelta(before, [
      { day: "2026-10-14", sessions: 1, focusMs: 25 * MIN },
      { day: "2026-10-15", sessions: 1, focusMs: 5 * MIN },
    ])
    assert.deepEqual(plain(after.days), {
      "2026-10-14": { sessions: 2, focusMs: 50 * MIN },
      "2026-10-15": { sessions: 1, focusMs: 5 * MIN },
    })
    assert.equal(before.days["2026-10-14"].sessions, 1)
  })

  test("a day taken back to zero disappears, and counts never go negative", () => {
    const s = Model.applyStatsDelta(statsOf({ "2026-10-14": { sessions: 1, focusMs: MIN } }),
      [{ day: "2026-10-14", sessions: -1, focusMs: -MIN }, { day: "2026-10-01", sessions: -1, focusMs: -MIN }])
    assert.deepEqual(plain(s.days), {})
  })

  test("seedStats counts today's finished work sessions only", () => {
    const history = [workEntry("2026-10-14", 25, 9), { phase: "short", startedAt: 1, endedAt: 2, ms: 1 }, workEntry("2026-10-14", 10, 11)]
    assert.deepEqual(plain(Model.seedStats(history)), statsOf({ "2026-10-14": { sessions: 2, focusMs: 35 * MIN } }))
  })

  test("serialize and restore round-trip", () => {
    const s = statsOf({ "2026-10-14": { sessions: 3, focusMs: 75 * MIN } })
    assert.deepEqual(plain(Model.restoreStats(Model.serializeStats(s))), s)
  })

  test("restoreStats returns null for unreadable files", () => {
    for (const raw of ["", "nope", "null", "[]", "{}", '{"days":[]}', '{"days":"x"}'])
      assert.equal(Model.restoreStats(raw), null, raw)
  })

  test("restoreStats drops bad days one by one", () => {
    const raw = JSON.stringify({ version: 1, days: {
      "2026-10-14": { sessions: 2, focusMs: 50 * MIN },
      "2026-10-15": { sessions: 1 },
      "yesterday": { sessions: 1, focusMs: 1 },
      "2026-10-16": { sessions: -1, focusMs: 1 },
      "2026-10-17": { sessions: "2", focusMs: 1 },
      "2026-10-18": null,
    } })
    assert.deepEqual(plain(Model.restoreStats(raw).days), {
      "2026-10-14": { sessions: 2, focusMs: 50 * MIN },
      "2026-10-15": { sessions: 1, focusMs: 0 },
    })
  })

  test("loadStats: a missing file is seeded from today's history", () => {
    assert.deepEqual(plain(Model.loadStats("", [workEntry("2026-10-14")])),
      { stats: statsOf({ "2026-10-14": { sessions: 1, focusMs: 25 * MIN } }), backup: false })
    assert.deepEqual(plain(Model.loadStats("  \n", [])), { stats: statsOf({}), backup: false })
  })

  test("loadStats: a readable file is used as is", () => {
    const s = statsOf({ "2026-10-01": { sessions: 4, focusMs: 100 * MIN } })
    assert.deepEqual(plain(Model.loadStats(Model.serializeStats(s), [workEntry("2026-10-14")])), { stats: s, backup: false })
  })

  test("loadStats: a corrupt file asks for a backup and starts over from today", () => {
    assert.deepEqual(plain(Model.loadStats("{oops", [workEntry("2026-10-14")])),
      { stats: statsOf({ "2026-10-14": { sessions: 1, focusMs: 25 * MIN } }), backup: true })
  })
})

describe("contribution graph", () => {
  const stats = statsOf({
    "2026-10-14": { sessions: 4, focusMs: 100 * MIN },
    "2026-10-13": { sessions: 1, focusMs: 25 * MIN },
    "2026-10-12": { sessions: 2, focusMs: 50 * MIN },
    "2025-10-12": { sessions: 9, focusMs: 1 },   // the day before the window
  })

  test("53 weeks of 7 days, the last column holding the end date's week", () => {
    const g = Model.contributionGrid(stats, "2026-10-14", 1, "2026-10-14")   // Wednesday, Monday start
    assert.equal(g.weeks.length, 53)
    for (const week of g.weeks) assert.equal(week.length, 7)
    const last = g.weeks[52]
    assert.deepEqual(plain(last.map((d) => d.key)),
      ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"])
    assert.equal(g.weeks[0][0].key, "2025-10-13")
    assert.equal(g.startKey, "2025-10-13")
    assert.equal(g.endKey, "2026-10-14")
  })

  test("columns follow the locale's week start", () => {
    const g = Model.contributionGrid(stats, "2026-10-14", 0, "2026-10-14")   // Sunday start
    assert.equal(g.weeks[52][0].key, "2026-10-11")
    assert.equal(Model.contributionGrid(stats, "2026-10-14", 7, "2026-10-14").weeks[52][0].key, "2026-10-11")
  })

  test("counts, today, future days and shading levels", () => {
    const last = Model.contributionGrid(stats, "2026-10-14", 1, "2026-10-14").weeks[52]
    assert.deepEqual(plain(last.slice(0, 4).map((d) => [d.count, d.level, d.today, d.future])), [
      [2, 2, false, false], [1, 1, false, false], [4, 4, true, false], [0, 0, false, true],
    ])
  })

  test("statsLevel splits by quarters of the busiest day", () => {
    assert.equal(Model.statsLevel(0, 8), 0)
    assert.equal(Model.statsLevel(1, 8), 1)
    assert.equal(Model.statsLevel(2, 8), 1)
    assert.equal(Model.statsLevel(3, 8), 2)
    assert.equal(Model.statsLevel(6, 8), 3)
    assert.equal(Model.statsLevel(8, 8), 4)
    assert.equal(Model.statsLevel(2, 3), 3)   // a 2 still shows when the max is 3
    assert.equal(Model.statsLevel(1, 0), 0)
  })

  test("month labels sit on the column holding the 1st, with no crowding at the start", () => {
    const g = Model.contributionGrid(stats, "2026-10-14", 1, "2026-10-14")
    const labels = plain(g.monthLabels)
    assert.equal(labels.length, 12)
    assert.deepEqual(labels[labels.length - 1], { column: 50, label: "Oct" })   // week of Mon 2026-09-28 holds Oct 1
    for (let i = 1; i < labels.length; i++) assert.ok(labels[i].column - labels[i - 1].column >= 3)
    assert.equal(labels[0].label, "Nov")
  })

  test("a leading partial month gets a label when there is room", () => {
    const g = Model.contributionGrid(statsOf({}), "2026-12-10", 1, "2026-12-10")   // first column Mon 2025-12-08, Jan 1 in column 3
    assert.deepEqual(plain(g.monthLabels[0]), { column: 0, label: "Dec" })
  })

  test("day labels on every other row, starting with the first", () => {
    assert.deepEqual(plain(Model.contributionGrid(stats, "2026-10-14", 1, "2026-10-14").dayLabels),
      ["Mon", "", "Wed", "", "Fri", "", ""])
    assert.deepEqual(plain(Model.contributionGrid(stats, "2026-10-14", 0, "2026-10-14").dayLabels),
      ["Sun", "", "Tue", "", "Thu", "", ""])
  })

  test("the range label names the first and last month", () => {
    assert.equal(Model.contributionGrid(stats, "2026-10-14", 1, "2026-10-14").rangeLabel, "Oct 2025 – Oct 2026")
  })

  test("day tooltips", () => {
    assert.equal(Model.dayTooltip({ key: "2026-10-14", count: 3 }), "3 work sessions · Wed 14 Oct 2026")
    assert.equal(Model.dayTooltip({ key: "2026-10-14", count: 1 }), "1 work session · Wed 14 Oct 2026")
    assert.equal(Model.dayTooltip({ key: "2026-10-14", count: 0 }), "No work sessions · Wed 14 Oct 2026")
  })

  test("calendar days stay consecutive across a DST switch", () => {
    const script = `
      const vm = require("node:vm"), fs = require("node:fs")
      const M = vm.createContext({})
      vm.runInContext(fs.readFileSync(${JSON.stringify(modelPath.pathname)}, "utf8"), M)
      const keys = M.contributionGrid({ version: 1, days: {} }, "2026-11-05", 1, "2026-11-05").weeks.flat().map((d) => d.key)
      const expected = []
      for (let t = Date.UTC(2025, 10, 3); expected.length < keys.length; t += 86400000) expected.push(new Date(t).toISOString().slice(0, 10))
      process.stdout.write(JSON.stringify({ ok: JSON.stringify(keys) === JSON.stringify(expected), first: keys[0], n: new Set(keys).size }))
    `
    const out = JSON.parse(execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: "Europe/Zurich" }, encoding: "utf8" }))
    assert.deepEqual(out, { ok: true, first: "2025-11-03", n: 371 })
  })
})

describe("stats summary and paging", () => {
  const stats = statsOf({
    "2026-10-14": { sessions: 2, focusMs: 50 * MIN },
    "2026-10-13": { sessions: 1, focusMs: 25 * MIN },
    "2026-10-10": { sessions: 5, focusMs: 125 * MIN },
    "2026-10-09": { sessions: 1, focusMs: 25 * MIN },
    "2026-10-08": { sessions: 1, focusMs: 25 * MIN },
    "2024-01-01": { sessions: 7, focusMs: 1 },
  })

  test("totals, streaks and best day within the window", () => {
    assert.deepEqual(plain(Model.statsSummary(stats, "2025-10-13", "2026-10-14", "2026-10-14")), {
      sessions: 10, focusHours: 4.2, currentStreak: 2, longestStreak: 3,
      bestDay: { key: "2026-10-10", sessions: 5 },
    })
  })

  test("the current streak survives a today without sessions yet", () => {
    assert.equal(Model.statsSummary(stats, "2025-10-13", "2026-10-15", "2026-10-15").currentStreak, 2)
    assert.equal(Model.statsSummary(stats, "2025-10-13", "2026-10-16", "2026-10-16").currentStreak, 0)
  })

  test("an empty window", () => {
    assert.deepEqual(plain(Model.statsSummary(statsOf({}), "2025-10-13", "2026-10-14", "2026-10-14")), {
      sessions: 0, focusHours: 0, currentStreak: 0, longestStreak: 0, bestDay: null,
    })
  })

  test("shiftYear pages by a year, never past today", () => {
    assert.equal(Model.shiftYear("2026-10-14", -1, "2026-10-14"), "2025-10-14")
    assert.equal(Model.shiftYear("2025-10-14", 1, "2026-10-14"), "2026-10-14")
    assert.equal(Model.shiftYear("2026-10-14", 1, "2026-10-14"), "2026-10-14")
    assert.equal(Model.shiftYear("2028-02-29", -1, "2028-03-01"), "2027-02-28")
  })
})

describe("stat tiles", () => {
  test("summary as labelled tiles", () => {
    const summary = { sessions: 10, focusHours: 4.2, currentStreak: 2, longestStreak: 3, bestDay: { key: "2026-10-10", sessions: 5 } }
    assert.deepEqual(plain(Model.statTiles(summary)), [
      { value: "10", label: "sessions" },
      { value: "4.2 h", label: "focus" },
      { value: "2 d", label: "current streak" },
      { value: "3 d", label: "longest streak" },
      { value: "5", label: "best day · Sat 10 Oct" },
    ])
  })

  test("no best day yet", () => {
    const tiles = Model.statTiles({ sessions: 0, focusHours: 0, currentStreak: 0, longestStreak: 0, bestDay: null })
    assert.deepEqual(plain(tiles[4]), { value: "–", label: "best day" })
  })
})

describe("rename to Pomarchy", () => {
  test("the old state folder is where the copy comes from", () => {
    assert.equal(Model.legacyStateDir({ XDG_STATE_HOME: "/x/state/", HOME: "/home/u" }), "/x/state/omarchy-pomodoro")
    assert.equal(Model.legacyStateDir({ HOME: "/home/u" }), "/home/u/.local/state/omarchy-pomodoro")
  })

  test("preparing the state folder copies old files over once, never overwriting", () => {
    assert.deepEqual(plain(Model.prepareStateDirCommand("/s/pomarchy", "/s/omarchy-pomodoro")), [
      "sh", "-c",
      'mkdir -p "$1" && for f in state.json stats.json; do [ -e "$1/$f" ] || [ ! -e "$2/$f" ] || cp "$2/$f" "$1/$f"; done',
      "sh", "/s/pomarchy", "/s/omarchy-pomodoro",
    ])
  })
})
