# Pomodoro for Omarchy

A Pomodoro timer that lives in the Omarchy bar. Work sessions and breaks count down in the bar. When a phase ends you hear a sound and get a notification, and **the next phase only starts once you confirm it**.

```
 Wednesday 15:38  󰔟 24:13      ← work session running
 Wednesday 16:02  󰂞 Break?     ← phase over, pulsing until you confirm
```

## Install

```bash
# from a git remote
omarchy plugin add <git-url> --enable

# or from a local checkout (development)
ln -s ~/Projects/omarchy-pomodoro ~/.config/omarchy/plugins/nambrosini.pomodoro
omarchy plugin enable nambrosini.pomodoro
```

Place it in the bar, for example right after the clock:

```bash
omarchy bar move nambrosini.pomodoro --after omarchy.clock
```

## Using it

Click the widget to open the popup; click it again (or press `Esc`) to close it. Hovering shows the phase, time left and session progress `●●○○`. Nothing else on the bar acts on the timer.

The popup has:

- **The timer**: time left inside a ring that fills as the phase goes by. While idle or awaiting, it shows the next phase and its full length instead, and the ring turns the urgent colour while a phase change waits for you.
- **Controls**, like an audio player:

  | Button | Action |
  |---|---|
  | 󰒮 Back | More than 5 s into a phase: restart it. Otherwise go to the previous phase (redoing a work session takes its count back) |
  | 󰐊 / 󰏤 Play / pause | Start, pause or resume. While awaiting, start the next phase |
  | 󰒭 Next | End the phase now (counted as done). While awaiting, start the next phase; a pending break is skipped in favour of work |
  | 󰓛 Stop | Back to idle. The stopped phase doesn't count; cycle progress and today's sessions stay |

- **Today**: the cycle dots and every phase finished today (`09:12–09:37 · 25 min`), newest first. The list empties at midnight.
- **Settings** (folded): work, short and long break lengths as chips, and the number of work sessions before a long break. Changes are saved to `shell.json` and apply from the next phase; a running phase keeps its length. A length set by hand that isn't a chip stays valid and shows as `custom: 50 min`.
- **Shortcuts** (folded):

  | Key | Action |
  |---|---|
  | `Space` / `Enter` | Play / pause |
  | `h` / `←` | Back |
  | `l` / `→` | Next |
  | `s` | Stop |
  | `g` | Stats (and back) |
  | `Esc` | Close (from stats: back to the timer) |

- **Stats** (the 󰄨 button, or `g`): a GitHub-style graph of the last 12 months, one square per day, shaded by the work sessions finished that day, with month labels, a less → more legend and tiles for total sessions, focus hours, current and longest streak, and best day. Hover a square for its count. `‹ ›` (or `h`/`l`, `←`/`→`) page a year back and forth; `←` or `Esc` returns to the timer. A session counts when it finishes, whether it runs out or you press Next. Back's "redo this work session" takes it away again; Stop and breaks never count.

Settings and Shortcuts start folded, and the popup starts on the timer, every time it opens.

The cycle is work → short break → work … and after every 4th work session (`sessionsBeforeLongBreak`), a long break. Changing that number mid-cycle moves the goal: progress since the last long break is kept, and if it already reaches the new number, the next work session earns the long break. When a phase ends:

- the sound plays (`pw-play`),
- a critical notification appears and stays until you click it ("Work session done / Click to start a 5 min short break"),
- the bar shows a pulsing bell, `Break?` or `Work?`, in the theme's urgent colour.

The next phase starts only after you click the notification, press play in the popup, or run `omarchy-shell pomodoro confirm`. Confirming one way closes the notification. Do Not Disturb hides the notification, but the bar keeps asking. The timer keeps running while the screen is locked.

## Settings

Settings live on the widget's entry in `~/.config/omarchy/shell.json`:

```bash
omarchy bar set nambrosini.pomodoro workMinutes 50
omarchy bar set nambrosini.pomodoro notify false --json
omarchy bar set nambrosini.pomodoro sound ""          # no sound
```

| Key | Default | |
|---|---|---|
| `workMinutes` | `25` | 1–180 |
| `shortBreakMinutes` | `5` | 1–180 |
| `longBreakMinutes` | `15` | 1–180 |
| `sessionsBeforeLongBreak` | `4` | 1–12 |
| `notify` | `true` | ask with a notification when a phase ends |
| `sound` | `/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga` | any file `pw-play` can play; `""` disables it |

## Scripts and keybindings

```bash
omarchy-shell pomodoro toggle      # start / pause / resume / confirm
omarchy-shell pomodoro confirm     # start the pending phase (or start work when idle)
omarchy-shell pomodoro skip      # the popup's Next, except it doesn't start pending work
omarchy-shell pomodoro back      # restart the phase, or go to the previous one
omarchy-shell pomodoro stop      # back to idle, keeping cycle progress
omarchy-shell pomodoro reset     # back to idle, clearing the session count
omarchy-shell pomodoro adjust 5    # ±minutes on the current phase
omarchy-shell pomodoro status      # JSON, see below
```

`status` prints:

```json
{"phase":"work","running":true,"paused":false,"awaiting":false,"remainingMs":1453000,"display":"24:13","next":"","completed":1}
```

`phase` is one of `idle`, `work`, `short`, `long`, `awaiting`. While awaiting, `next` names the phase waiting to start.

Example bindings for `~/.config/hypr/bindings.lua` (`SUPER + ALT + P` is unbound on a stock Omarchy; check with `omarchy menu keybindings --print`):

```lua
o.bind("SUPER + ALT + P", "Pomodoro toggle", "omarchy-shell pomodoro toggle")
o.bind("SUPER + ALT + SHIFT + P", "Pomodoro skip", "omarchy-shell pomodoro skip")
```

## State

The stats live next to the timer in `stats.json` (one total per day, kept indefinitely: about 15 KB a year). It is a separate file so a timer state that has to be reset can never take the history with it. Counting started with the version that added the stats view: earlier days were never stored, so the graph begins then (that day's finished sessions are counted in). If `stats.json` can't be read it is kept as `stats.json.bad-<time>` and a fresh one is started.

The timer, cycle progress and today's finished phases are stored, with the timer as an absolute end time, in `$XDG_STATE_HOME/omarchy-pomodoro/state.json` (by default `~/.local/state/omarchy-pomodoro/state.json`), so it doesn't drift and it survives shell restarts and reboots. A phase that ran out while the shell was down alerts as soon as the shell starts again.

## Known limitations

- After a full shell restart while a phase change is pending, the old notification can't confirm anything any more. Use the widget or `omarchy-shell pomodoro confirm`. (A plugin hot-reload replaces the popup with a working one.)
- If `pw-play` fails, it fails silently. The urgent bar state is the reliable signal.

## Development

```bash
node --test 'tests/*.test.mjs'                                  # unit + contract tests
node --test --experimental-test-coverage 'tests/*.test.mjs'     # coverage
omarchy plugin validate .
/usr/lib/qt6/bin/qmllint Service.qml ProgressRing.qml       # the others need the shell's qs.* imports
omarchy restart shell                                           # load QML changes (see below)
```

All timer logic lives in `Model.js`: pure functions with no Qt, tested under node. `Service.qml` is the single timer instance (state, persistence, alerts, IPC). `BarWidget.qml` is the per-monitor view and hosts `Panel.qml`, the popup (with `ProgressRing.qml`, `CollapsibleSection.qml` and `ContributionGraph.qml`).

When the plugin is symlinked into `~/.config/omarchy/plugins/`, `omarchy-shell shell rescanPlugins` does not reload the service code. Use `omarchy restart shell`; the timer state survives it.

The TDD evidence for every phase is in [`docs/tdd/pomodoro-model.tdd.md`](docs/tdd/pomodoro-model.tdd.md).
