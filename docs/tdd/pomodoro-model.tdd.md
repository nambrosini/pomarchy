# TDD evidence: Pomodoro state machine (Phase 1)

**Source plan:** inline `/ecc:plan` in session (revised plan, confirmed 2026-10-14)
**Scope:** `Model.js` only, the pure state machine. The QML widget is Phase 2.

## User journeys
- As a user, I start a 25 min work session from the bar and see it count down.
- As a user, when a phase ends I get asked to confirm before the next phase starts.
- As a user, after 4 work sessions I get a long break instead of a short one.
- As a user, I can pause, resume, skip, reset, and nudge the timer by ±1 min.
- As a user, a running timer survives a shell restart, and garbage state never crashes the widget.

## RED / GREEN
| Stage | Command | Result |
|---|---|---|
| RED | `node --test 'tests/*.test.mjs'` against a stub `Model.js` | 45 tests, 0 pass, 45 fail: `Model.initialState is not a function`, `Model.normalizeConfig is not a function`, … |
| GREEN | same command after implementation | 45 tests, 45 pass, 0 fail |
| Coverage | `node --test --experimental-test-coverage 'tests/*.test.mjs'` | `Model.js`: 100% lines, 94.29% branches, 100% functions |

There are no git checkpoints because the project is not a git repository yet.

## What the tests guarantee
| # | Guarantee | Test (describe › test) |
|---|---|---|
| 1 | Defaults are 25/5/15 min with a long break every 4 sessions. Strings are accepted, bad values fall back, and durations are capped at 180 min. | normalizeConfig › * |
| 2 | Start, pause, resume and toggle work. Remaining time is frozen while paused and never goes negative. | start / pause / resume › * |
| 3 | A finished phase parks in `awaiting` and never starts the next phase by itself | tick › "the next phase never starts by itself" |
| 4 | Confirm (or toggle) starts the pending phase with the right duration | tick › "confirm starts the pending break" |
| 5 | `isTransition` is true only on the tick where a phase ends, so alerts fire once | tick › "isTransition…" |
| 6 | A long break comes after every N work sessions, where N is configurable | long breaks › * |
| 7 | Skip ends a phase (counted as done). Skipping while awaiting a break starts work. Otherwise skip does nothing. | skip › * |
| 8 | Adjust changes the remaining time by ±1 min (never below 1 min) and only applies to timed phases | adjust › * |
| 9 | Saved state round-trips. Malformed JSON or bad fields restore to idle. A phase that expired during downtime fires one transition. A restored `awaiting` state does not fire again. | persistence › * |
| 10 | Notification text and bar text are correct for each state | labels › * |

## Known gaps
- QML wiring (timer, `notify-send --wait`, `pw-play`, file I/O, IPC) has no automated tests. It gets checked by hand in the live shell in Phases 2–5.

---

# Phase 2: bar widget and shared service

**Design:** `Service.qml` (one instance per shell) holds the timer. `BarWidget.qml` (one per monitor) renders it and forwards clicks, reaching the service through `bar.shell.serviceFor("nambrosini.pomodoro")`. This copies the `omarchy.media` service + bar-widget pattern.

## RED / GREEN
| Stage | Command | Result |
|---|---|---|
| RED | `node --test 'tests/*.test.mjs'` | 55 tests, 46 pass, 9 fail: `Model.icon/isUrgent/sessionDots/tooltip is not a function` ×8, plus `ENOENT manifest.json` |
| GREEN | same | 64 tests, 64 pass |
| Validator | `omarchy plugin validate .` | exit 0 |
| Lint | `/usr/lib/qt6/bin/qmllint Service.qml` | Found `property "state" already exists in base type QQuickItem`, fixed by renaming to `timerState`. Exit 0 after the fix. |
| Live load | symlink into `~/.config/omarchy/plugins/`, then `rescanPlugins`, `plugin enable`, `bar move --after omarchy.clock` | `nambrosini.pomodoro enabled third-party service,bar-widget`. No plugin errors in `quickshell log`. Idle icon renders after the clock (screenshot). |

## Added guarantees
| # | Guarantee | Test |
|---|---|---|
| 11 | Icon for each state (idle, work, short, long, paused, awaiting) | widget presentation › icon per state |
| 12 | Only `awaiting` is urgent | widget presentation › only the awaiting state is urgent |
| 13 | Session dots fill per work session and stay full through the long break | widget presentation › session dots * |
| 14 | Tooltip text for idle, running, paused and awaiting | widget presentation › tooltip * |
| 15 | Manifest: id, service + bar-widget kinds, entry points exist, no `keepLoaded`, single instance, schema and defaults match `Model.normalizeConfig` | manifest.test.mjs › * |

## Known gaps
- Clicks, scroll, the pulse animation and multi-monitor sync have no automated tests. They are checked by hand in the live bar.

---

# Phase 3: notification, sound, and confirm by clicking

**Behaviour:** when a phase ends, the service plays `pw-play <sound>` and shows a **critical** `notify-send --print-id --action=default=…` popup. The Omarchy daemon gives critical popups no timeout, so it stays until answered. Clicking it prints `default`, which confirms through `Model.confirmPending`; a stale click after a reset can't start a session. Confirming from the bar, skipping or resetting closes the popup by id over D-Bus (`CloseNotification`). Do Not Disturb still silences the popup, because the daemon's bypass applies only to app name `notify-send`, but the bar stays urgent.

**Probe:** `notify-send -a Pomodoro -p -A default=Start …` prints the id (`1`) right away. Closing it with `gdbus … CloseNotification 1` makes it exit 0 with no further output.

## RED / GREEN
| Stage | Command | Result |
|---|---|---|
| RED | `node --test 'tests/*.test.mjs'` | 75 tests, 63 pass, 12 fail: `notifyCommand/soundCommand/parseNotifyLine/closeNotificationCommand/confirmPending is not a function`, `normalizeConfig` missing `notify`/`sound`, manifest schema missing `notify`/`sound` |
| GREEN | same | 75 tests, 75 pass |
| Lint | `qmllint Service.qml` | exit 0 |
| Live reload | `omarchy-shell shell rescanPlugins` | `Local plugin changed, reloading: nambrosini.pomodoro`, no errors |

## Added guarantees
| # | Guarantee | Test |
|---|---|---|
| 16 | `notify` (bool, also accepts the string `"false"`) and `sound` (path, `""` = no sound) settings with defaults | normalizeConfig › * |
| 17 | Exact notify-send argv: critical, prints its id, a default action named after the next phase | phase-change alerts › notification * |
| 18 | No popup when `notify` is off or the timer isn't awaiting | phase-change alerts › no notification … |
| 19 | Exact pw-play argv; nothing when the sound is empty | phase-change alerts › sound … |
| 20 | stdout parsing: the first numeric line is the id, the next line is the action; blank or invalid lines are ignored | phase-change alerts › parses / ignores |
| 21 | Exact gdbus CloseNotification argv, and nothing for an invalid id | phase-change alerts › closes … |
| 22 | A notification click confirms only while awaiting | phase-change alerts › a notification click … |

## Known gaps
- Clicking the popup and hearing the sound are checked by hand: I can't click layer-shell surfaces from the agent.
- `pw-play` failures are not detected, because it runs detached. The urgent bar state is the reliable signal.

---

# Phase 4: surviving a shell restart

**Behaviour:** the state is saved to `$XDG_STATE_HOME/omarchy-pomodoro/state.json`, or `~/.local/state/…` when that variable isn't set. Writes are atomic (`FileView`, `atomicWrites: true`) and happen only when the state changes, never on every tick. Nothing is written until the saved state has been read, so a starting instance can't overwrite it. On load, the in-memory hot-reload copy wins over the file.

## RED / GREEN
| Stage | Command | Result |
|---|---|---|
| RED | `node --test 'tests/*.test.mjs'` | 80 tests, 75 pass, 5 fail: `Model.stateDir is not a function` ×2, `Model.pickSaved is not a function` ×3 |
| GREEN | same | 80 tests, 80 pass |
| Lint | `qmllint Service.qml` | exit 0 |

## End-to-end checks in the live shell
| # | Scenario | How | Observed |
|---|---|---|---|
| E1 | First start creates the directory and writes nothing | `omarchy restart shell` | `~/.local/state/omarchy-pomodoro/` exists and is empty |
| E2 | A running timer resumes after a restart | seed `{"phase":"work","running":true,"endsAt":now+10min,…}`, then restart | bar shows `09:56` (screenshot `bar-resumed.png`) |
| E3 | A phase that ended during downtime alerts on start | seed `endsAt: now-60s`, then restart | file → `awaiting`, `completed: 2`, `next: short`. `pw-play …alarm-clock-elapsed.oga` and `notify-send --urgency=critical … --action=default=Start short break` running. Bar shows a red bell `Break?`. Popup "Work session done / Click to start a 5 min short break" visible (screenshots). |
| E4 | Confirming the popup starts the break | the popup from E3 | the state became `short`, running, at 15:38:56, about 10 s after the popup appeared. **The user confirmed they clicked the popup**, so click-to-confirm is verified end to end. |

## Finding: the dev reload loop
`omarchy-shell shell rescanPlugins` (and `quickshell ipc … rescanPlugins`) returned OK but did **not** re-create the service from new code: a temporary `console.log` in `Component.onCompleted` never appeared. The inotify watcher also misses edits made through the `~/.config/omarchy/plugins/nambrosini.pomodoro` symlink. `omarchy restart shell` loads fresh code. Since state now survives restarts, that is the reliable dev loop, and it also means Phases 2–3 were only verified live from this point on.

## Added guarantees
| # | Guarantee | Test |
|---|---|---|
| 23 | The state directory follows `XDG_STATE_HOME`, with a trailing slash tolerated, and falls back to `~/.local/state` | state file › lives under / falls back |
| 24 | The hot-reload copy wins over the file; the file is used after a restart; missing values give `""` | state file › the hot-reload copy / the file is used |
| 25 | A serialized running timer resumes with the correct remaining time, including the file's trailing newline | state file › a timer saved by one shell … |

---

# Phase 5: IPC and README

**Behaviour:** `Service.qml` registers `IpcHandler { target: "pomodoro" }` with `toggle`, `confirm`, `skip`, `reset` and `adjust(minutes: int)`, each returning `ok`, plus `status`, which returns the JSON from `Model.status`. The service is the only instance, so the target never collides across monitors.

## RED / GREEN
| Stage | Command | Result |
|---|---|---|
| RED | `node --test 'tests/*.test.mjs'` | 93 tests, 80 pass, 13 fail: `Model.status is not a function` ×4, no `IpcHandler`/`target: "pomodoro"`/methods in Service.qml ×8, `README.md missing` ×1 |
| GREEN | same | 93 tests, 93 pass |
| Validator / lint | `omarchy plugin validate .`, `qmllint Service.qml` | both exit 0 |

## End-to-end over IPC (after `omarchy restart shell`)
`quickshell ipc show` lists `target pomodoro` with all 6 functions. Sequence run against the live shell (workMinutes was still 1 from the user's test):

| Call | Status afterwards |
|---|---|
| `reset` | `idle`, `completed: 0` |
| `toggle` | `work`, running, `01:00` |
| `toggle` | `paused: true`, `00:59` |
| `skip` | `awaiting`, `next: short`, `display: Break?`, `completed: 1` |
| `confirm` | `short`, running, `05:00` |
| `adjust 5` then `adjust -3` | `06:00`, then `03:00` |
| `reset` | `idle` |

The first `adjust 5` attempt returned `Function not found`. That was a fault in the test harness: zsh doesn't word-split `$c`, so the shell received a function literally named `"adjust 5"`. A direct call works.

## Added guarantees
| # | Guarantee | Test |
|---|---|---|
| 26 | `status` JSON shape for idle, running, paused and awaiting | status for scripts › * |
| 27 | Service.qml declares the `pomodoro` target and every documented method, with `adjust(minutes: int)` typed | ipc.test.mjs › * |
| 28 | The README documents every IPC command | ipc.test.mjs › README documents every command |

---

# Review fixes (all 4 findings from `/code-review`)

| # | Finding | Fix |
|---|---|---|
| 1 (MEDIUM) | `button.opacity = 1` broke WidgetButton's opacity binding, so paused stopped dimming after the first pulse | Pulse moved to the widget root, which has no opacity binding; nothing assigns `button.opacity` |
| 2 (LOW) | The startup tick could alert before the widget had sent the settings | `startIfReady()` waits for both the state file and `configure()`. A 3 s fallback uses the defaults if no widget attaches. The main Timer only runs once `started` is set. |
| 3 (LOW) | A popup closed without a click left a stale id behind, and a hot-reload would bring it back | One `Process` per popup, created from a `Component`. On exit, `Model.notificationClosed(current, own)` clears the id only if it is still current, and only the current popup's click is accepted (`Model.isCurrentNotification`). The `running=false/true` restart is gone. |
| 4 (LOW) | `paused` was written twice | `Model.isPaused`, used by `Service.paused`, `icon()` and `status()` |

## RED / GREEN
| Stage | Command | Result |
|---|---|---|
| RED | `node --test 'tests/*.test.mjs'` | 99 tests, 93 pass, 6 fail: `isPaused` ×2, `notificationClosed`, `isCurrentNotification` not functions; `/button\.opacity\s*=/` matched; `pulse is declared inside WidgetButton` |
| GREEN | same | 99 tests, 99 pass |
| Validator | `omarchy plugin validate .` | pass |

## Live verification (after `omarchy restart shell`)
| Fix | Check | Observed |
|---|---|---|
| 2 | seed an expired work phase, then restart | `awaiting`, `next: short`, one popup "…5 min short break" (startup alert still fires, now after settings) |
| 3 | `confirm` while the popup is open | popup process exits, 0 left |
| 3 | from awaiting a break: `skip` → `skip` | exactly 1 popup, new pid (258720 → 258746); `reset` → 0 |
| 3 | close the popup without a click (D-Bus `CloseNotification`, like the X button) | process exits, state stays `awaiting`, so there is no false confirm |
| 1 | pulse (skip → confirm), then pause | widget grey (dimmed), screenshot `fix-paused-after-pulse.png`. Before the fix it was full brightness. |
| all | `quickshell log` | no errors from Service.qml, BarWidget.qml or Model.js |

New tests: `tests/widget.test.mjs` (source guards for #1) and `model.test.mjs › review fixes`.

---

# Phase 6: popup panel

**Source plan:** `/ecc:plan` in session (popup panel), confirmed 2026-10-14. The plan calls this "Phase 3"; it is numbered 6 here because Phases 1–5 already exist in this file.
**Behaviour:** a left click on the bar widget opens a popup (`Panel.qml`): the time inside a `ProgressRing`, back · play/pause · next · stop, today's finished phases with the cycle dots, and folded Settings (duration chips, cycles stepper) and Shortcuts sections. Every other bar action (right, middle, scroll) is gone. `back` and `stop` are also IPC commands.

## User journeys (from the plan)
- As a user, I click the bar timer and get a player-style popup instead of an immediate action.
- As a user, I can go back (restart the phase, or go to the previous one in its first 5 s), stop without losing cycle progress, and skip forward.
- As a user, I see today's finished phases, and the list empties after midnight.
- As a user, I change durations and the cycle count from the popup, and they persist to `shell.json`.
- As a user, changing the cycle count mid-cycle never gives a long break too early.

## RED / GREEN
| Stage | Command | Result |
|---|---|---|
| Baseline | `TZ=UTC node --test 'tests/*.test.mjs'` | 99 tests, 99 pass |
| RED (Tasks 1–2, model) | same, after adding the model tests | 154 tests, 100 pass, 54 fail: `Model.back/stop/next/panelView/pruneHistory/durationOptions/chipValue/settingsMinutes/stepCycles is not a function`; `cycle`, `startedAt`, `durationMs`, `history` undefined; old-format restore → `"undefined" is not valid JSON`; idle tooltip still had click hints |
| GREEN (model) | same | 154 tests, 154 pass |
| RED (Tasks 3–5, QML guards) | same, after `ipc.test.mjs` COMMANDS + `widget.test.mjs` + new `panel.test.mjs` | 175 tests, 153 pass, 22 fail: IPC `back`/`stop` missing ×2, README missing `back` ×1, Service `panelView`/`back`/`stop`/`next`/restore args ×5, Panel.qml/ProgressRing.qml absent ×9, BarWidget still had `onWheelMoved`, `service.skip()` etc. ×5 |
| GREEN | same, after Service/BarWidget/Panel/ProgressRing/CollapsibleSection and the README | 175 tests, 175 pass |
| Fix from the live check | added guard "both sections fold again whenever the popup closes" (fails without the fix in `Panel.qml`) | 176 tests, 176 pass |
| Coverage | `TZ=UTC node --test --experimental-test-coverage 'tests/*.test.mjs'` | `Model.js`: 100% lines, 96.85% branches, 100% functions |
| Validator | `omarchy plugin validate .` | exit 0 |
| Lint | `/usr/lib/qt6/bin/qmllint Service.qml ProgressRing.qml` | exit 0. qmllint can't resolve the shell's `qs.Commons`/`qs.Ui` imports, so for BarWidget/Panel/CollapsibleSection it only checks syntax; the live load is the real check (no QML errors in `quickshell log`). |

No git checkpoints: the project is not a git repository.

## Interpretations and deviations from the plan
| Plan text | What was built | Why |
|---|---|---|
| "`cycle` resets to 0 when the long break starts" | `cycle` resets when the long break **ends** (or when an earned long break is skipped) | Same decisions for the user (the next break is decided only after the long break), but the dots stay full through the long break with no special case, and `back` from a long break can give the work session's count back exactly |
| Back "while awaiting: redo the work session that just ended" | While awaiting, back replays **the phase that just ended**: the work session (count taken back) when a break is pending, the break when work is pending | Music-player reading of "previous"; the plan's sentence only covered awaiting a break |
| Back to a break also removes that break's history entry | Same rule as redoing a work session | Otherwise a replayed break would appear twice in Today |
| `restore(raw)` | `restore(raw, config, now)`: `config` gives an old file's `durationMs`, `now` prunes history; both optional | The plan asks for both behaviours, and `restore` had neither input |
| Malformed new fields "fall back as before" | A present but wrong-typed `cycle`/`durationMs`/`startedAt`/`history` → idle; invalid history *entries* are dropped individually | Matches the existing all-or-nothing rule for fields without losing a whole day over one bad entry |
| Old file pending a long break | `cycle` migrates as `completed % 4`, but set to 4 when that gives 0 with a long break pending | Keeps the dots full until the long break is over |
| Hero text `Style.font.display` | `Style.font.displayLarge × 1.5` | 24 px looked lost inside a 180 px ring; the clock popup uses a decorative 52 px hero too |
| Sections "start collapsed every time the popup is created" | They fold again every time the popup closes | The Panel object lives as long as the shell, so "created" happens only once; found in the live check, see below |
| Manifest | Description updated, version 0.2.0; no extra files declared | The shell loads Panel.qml through a relative `Loader`, as the clock does; `omarchy plugin validate` passes |

## Live checks (after `omarchy restart shell`)
| # | Check | Observed |
|---|---|---|
| L1 | Plugin loads | No QML errors in `quickshell log`; the state file migrated in place (`cycle`, `durationMs`, `startedAt`, `history` written on the next change) |
| L2 | Popup opens from `omarchy-shell shell toggle nambrosini.pomodoro` | Idle view: ring, "Work session next · 25:00", back/next/stop dimmed, TODAY `○○○○` "No sessions yet today", duration chips with 25/5/15 highlighted, cycles stepper at 4 (screenshot `open2.png`). The first toggle after the first restart showed nothing; with debug logging the panel reported `opened true` and showed. Not reproduced since. |
| L3 | Popup keys | **Inconclusive.** Space started work from idle and `s` stopped it, but the popup was not on screen for most of the run: another app had keyboard focus, so the injected keys went there instead. Stopped there; needs a manual check. |
| L4 | Sections start folded | Found Settings expanded on a later opening; fixed by folding on close (guard test added) |
| L5 | `shell.json` untouched by the run | `diff` against a backup: unchanged |

Not yet verified live (needs a manual click; layer-shell surfaces can't be clicked from the agent): a chip or stepper click writing `shell.json`, running/paused/awaiting screenshots, all controls by mouse, the N = 2 long-break walk-through, and bar right/middle/scroll doing nothing.

## Added guarantees
| # | Guarantee | Test |
|---|---|---|
| 29 | `begin` records `startedAt`/`durationMs`; `adjust` moves `durationMs` by the applied delta | phase bookkeeping › * |
| 30 | Finished phases go to history: a natural end at `endsAt`, a skip at `now`, time spent excludes pauses; breaks don't count as sessions | phase bookkeeping › * |
| 31 | Long break when `cycle ≥ N`; N = 4 gives s,s,s,L; raising N mid-cycle never gives an early long break; lowering it below `cycle` earns it next; a skipped long break still starts a new cycle | long break after N cycles › * |
| 32 | History keeps only today's entries (local midnight) and at most 50, without mutating its input | history › * |
| 33 | Old state files migrate, new fields round-trip, malformed new fields → idle, bad entries dropped, yesterday pruned on restore | restore with the new fields › * |
| 34 | Back: idle no-op; > 5 s restarts running; ≤ 5 s goes to the previous phase (break before work, long after a long break, redo work from a break or while awaiting a break, replay the break while awaiting work) | back › * |
| 35 | Stop: idle, the stopped phase is not counted, cycle and history kept, play continues the cycle | stop › * |
| 36 | Next: skip, plus awaiting work starts work; idle no-op | next › * |
| 37 | panelView per state (idle, running, paused, awaiting): title, display, progress 0..1, flags, dots, today's history newest first with local times | panelView › * |
| 38 | Duration chips, custom-value note, settings read back, cycles stepper clamped 1..12 | settings helpers › * |
| 39 | Bar: no wheel, no timer actions, a left click toggles the panel, Panel.qml loaded with the service, the `findPanelWidget` shape | widget.test.mjs › BarWidget hosts the popup |
| 40 | Service: `panelView`, `back`/`stop`/`next` actions, restore gets config and clock; IPC `back`/`stop` documented | panel.test.mjs › Service…, ipc.test.mjs |
| 41 | Panel: keyboard panel owned by the bar widget, controls gated by panelView, two collapsible sections that never start expanded and fold on close, chips from the model, settings written through `updateEntryInline`, key map and shortcuts list | panel.test.mjs › Panel, Panel folding |
| 42 | ProgressRing: track + value `PathAngleArc`, round caps, smoothed progress | panel.test.mjs › ProgressRing |

---

# Phase 7: stats view

**Source plan:** `/ecc:plan` in session (stats view), approved with "Proceed." on 2026-10-14.
**Behaviour:** finished work sessions are archived per local day in `stats.json`, next to `state.json` but separate from it. A chart button in the popup, or `g`, switches it to a GitHub-style graph of the last 12 months (53 × 7 squares shaded by sessions per day), with ‹ › year paging, hover tooltips, a legend and summary tiles.

## User journeys (from the plan)
- As a user, I open the stats from the popup and see a year of work sessions at a glance.
- As a user, every work session I finish is counted on its day, and one I redo with Back is taken back.
- As a user, the stats survive restarts, and a reset timer state or a corrupt file never loses them.

## RED / GREEN
| Stage | Command | Result |
|---|---|---|
| Baseline | `TZ=UTC node --test 'tests/*.test.mjs'` | 176 tests, 176 pass |
| RED (Tasks 1–2, model) | same, after adding the archive/graph/summary tests | 205 tests, 176 pass, 29 fail: `Model.contributionGrid` ×7, `statsDelta` ×5, `statsSummary` ×3, `serializeStats/restoreStats/loadStats/applyStatsDelta` ×2 each, `statsLevel/shiftYear/seedStats` ×1 each `is not a function`, plus `dayKey`, `dayTooltip` and the DST child process |
| GREEN (model) | same | 205 tests, 205 pass (two fixtures fixed first: a day meant to sit outside the window was inside it; the leading-label case needed a window whose first 1st falls in column 3) |
| RED (Tasks 3–4, QML guards) | same, after the Service/Panel/ContributionGraph guards | 217 tests, 205 pass, 12 fail: no `statsFile`/`loadStats`/backup/`statsDelta` in `apply`/`todayKey` in Service ×5, no stats view/button/`g`/width/model calls/shortcut in Panel ×6, no ContributionGraph.qml ×1 |
| RED (stat tiles) | same | 219 tests, 209 pass, 10 fail: `Model.statTiles is not a function` ×2, plus the open Panel/graph guards |
| GREEN | same | 219 tests, 219 pass. One guard from Phase 6 (`onCloseRequested: root.close()`) was updated because the plan changes that behaviour: `Esc` in stats returns to the timer. |
| Coverage | `TZ=UTC node --test --experimental-test-coverage 'tests/*.test.mjs'` | `Model.js`: 100% lines, 97.15% branches, 100% functions |
| Validator / lint | `omarchy plugin validate .`; `qmllint Service.qml ProgressRing.qml` | both exit 0 |

No git checkpoints: the project is not a git repository.

## Interpretations and deviations from the plan
| Plan text | What was built | Why |
|---|---|---|
| A −1 is recorded for a work entry that is "missing after, while still ended today" | A −1 is recorded only when the previous **last** entry disappears **and** a work session restarts (Back's replay) | `reset` also empties today's list; under the plan's rule it would have subtracted sessions that really happened |
| `restoreStats` returns null and "the caller decides" | Added `loadStats(raw, history)` → `{stats, backup}`, a pure function covering empty, readable and corrupt files | Keeps the decision under test instead of in QML |
| Summary formatting | `statTiles(summary)` in the model | Display strings tested, like `panelView` |
| The current streak "within the visible window" | Totals and the longest streak use the window; the current streak always counts back from today | A streak "now" is only meaningful relative to today |
| Width `Style.space(780)` | The width is the graph's `implicitWidth` plus the card's padding and border | The fixed width clipped the last 3 weeks live (see L2) |
| Day labels | Rows 1, 3, 5 of the week (Mon · Wed · Fri for a Monday start; Sun · Tue · Thu for Sunday) | As planned; this shell's locale starts weeks on Sunday, matching the clock popup |

## Live checks (after `omarchy restart shell`, no injected keys)
| # | Check | Observed |
|---|---|---|
| L1 | Seeding | `stats.json` created on first start as `{"2026-10-14":{"sessions":1,"focusMs":1500000}}`, which is today's one finished work session from `state.json` |
| L2 | Stats view renders (temporary `view: "stats"` default, reverted afterwards) | The first build clipped the last 3 columns, the range label and "more": `contentWidth` includes the card's padding. Fixed as above. Second screenshot `stats-live2.png`: 53 columns, months Nov→Oct, today outlined and shaded, future days empty, › dimmed at today, tiles `1 · 0.4 h · 1 d · 1 d · best day Wed 14 Oct` |
| L3 | Counting through the real Service (IPC) | confirm+skip → today 2 sessions, `focusMs` +1034; back → exactly 1 / 1 500 000 again; stop → unchanged |
| L4 | No QML errors | `quickshell log`: nothing from Panel/ContributionGraph/Service/Model |

Not verified live (needs a mouse or a focused popup): the stats button and `g`, ← / `Esc` back, year paging, hover tooltips, the popup returning to the timer after closing.

## Added guarantees
| # | Guarantee | Test |
|---|---|---|
| 43 | Day keys are local calendar dates; grid days stay consecutive across a DST switch (child process with `TZ=Europe/Zurich`) | dayKey, contribution graph › DST |
| 44 | Finished work sessions add to their day; breaks, pauses, stop, ticks, reset and midnight pruning add or remove nothing; Back's redo subtracts | statsDelta › * |
| 45 | The archive adds per day without mutating its input, drops days at zero, never goes negative, seeds from today, round-trips, rejects unreadable files and drops bad days individually; a corrupt file asks for a backup | stats archive › * |
| 46 | 53 × 7 grid ending on the end date's week, locale week start, counts, levels by quarters, today and future flags, month labels without crowding, day labels, range label, tooltips | contribution graph › * |
| 47 | Totals, focus hours, current and longest streak, best day; year paging capped at today with Feb 29 clamped; tiles | stats summary and paging › *, stat tiles › * |
| 48 | Service: a separate atomic `stats.json`, loaded after the timer state, backed up before being replaced, fed from `apply()`, graph keyed by `todayKey` | panel.test.mjs › Service keeps the stats archive |
| 49 | Panel: stats button and `g`, the timer default restored on close, stats-only keys, width from the graph, graph/summary/paging from the model, `g` in Shortcuts; ContributionGraph renders the model's weeks, labels, tooltips and legend | panel.test.mjs › Stats view, ContributionGraph |

---

# Phase 8: renamed to Pomarchy

**Change:** the project is now **Pomarchy**. Plugin id `nambrosini.pomodoro` → `nambrosini.pomarchy`, IPC target `pomodoro` → `pomarchy`, state folder `omarchy-pomodoro` → `pomarchy`, notification app name and tooltip → `Pomarchy`, manifest version 0.3.0. Earlier phases above keep the old names, because that is what was run at the time. The word "Pomodoro" stays in the README title and intro and in the manifest descriptions, so searches for "omarchy pomodoro" still find the project.

**Migration:** before the state is read, the service runs `Model.prepareStateDirCommand(dir, legacyDir)`. It creates the new folder and copies `state.json` and `stats.json` from `omarchy-pomodoro/` only when the new folder lacks them. Nothing is overwritten, and the old folder is left in place. The state file is now read when that command exits, replacing the old "mkdir, then read one tick later" race.

## RED / GREEN
| Stage | Command | Result |
|---|---|---|
| RED | `TZ=UTC node --test 'tests/*.test.mjs'` after updating the tests to the new names | 223 tests, 212 pass, 11 fail: IPC target, README commands, manifest id, tooltip, notify app name, state dir ×2, `legacyStateDir`/`prepareStateDirCommand` not functions, old ids in QML, no migration before the read |
| GREEN | same | 223 tests, 223 pass |
| Validator / lint | `omarchy plugin validate .`; `qmllint Service.qml` | both exit 0 |

## Added guarantees
| # | Guarantee | Test |
|---|---|---|
| 50 | The manifest id is `nambrosini.pomarchy` and its name `Pomarchy`; the IPC target is `pomarchy`, and the README documents `omarchy-shell pomarchy …` | manifest.test.mjs, ipc.test.mjs |
| 51 | No QML file still references `nambrosini.pomodoro`/`-pomodoro` | panel.test.mjs › Pomarchy identity |
| 52 | The new state folder is `…/pomarchy`; state is copied once from `…/omarchy-pomodoro`, never overwriting, before the first read | rename to Pomarchy › *, panel.test.mjs › Pomarchy identity |

## Live check and a race it exposed
| # | Check | Observed |
|---|---|---|
| R1 | Your setup moved: symlink renamed to `nambrosini.pomarchy`, bar entry id changed in `shell.json` (backup kept), shell restarted | `omarchy plugin list`: `nambrosini.pomarchy enabled third-party service,bar-widget Pomarchy`; `omarchy-shell pomarchy status` answers |
| R2 | First start with no `pomarchy/` folder | Both files were copied, but the timer started **empty** (`completed: 0` while the file said 1). FileView reads as soon as it has a path, before the copy finished; that failed read marked the state as loaded, so the real read was ignored. Before the rename the file always existed, which hid the race. |
| R3 | Fix: `stateDirReady`, set when the prepare command exits; `loadState` ignores any read before it. RED: 224 tests, 2 fail (the two guards); GREEN: 224 pass | — |
| R4 | R2 repeated with the new folder moved aside | Copied and loaded: `completed: 1`, stats `{"2026-10-14":{"sessions":1,…}}` |
