# TDD evidence: Ad-hoc sessions (`start N`)

**Source plan:** `.claude/plans/05-adhoc-sessions.plan.md`
**Branch:** `feat/adhoc-sessions`

## User journeys
- As a user, I run `omarchy-shell pomarchy start 45` from a keybinding to begin one 45 min work session without changing my settings.
- As a user, a script that calls `start` while a phase runs gets `busy` back, and my running session is left alone.
- As a user, an ad-hoc session counts in history, stats and cycle progress like any other work session.

## Decisions
- **Back restarts at the current length.** After the 5 s grace period (and within it, for the very first session), Back restarts the phase with `state.durationMs`. A custom session keeps its custom length, and an adjusted session keeps its adjusted length. Before this change, Back restarted at the configured length.
- **Clamping follows `normalizeConfig`.** Over 180 is capped at 180. Negative, zero, missing or non-numeric values fall back to the configured work length.
- **Busy detection** relies on `Model.start` returning the same state object, and `Service.start` compares against it.
- The README already binds `SUPER+ALT+P` to toggle, so the 50 min example uses `SUPER+ALT+CTRL+P`.

## RED / GREEN
| Stage | Commit | Command | Result |
|---|---|---|---|
| RED | `test: add RED tests for ad-hoc start N sessions` | `TZ=UTC node --test 'tests/*.test.mjs'` | 237 tests, 225 pass, 12 fail (minutes ignored, Back used config length, no IPC `start`) |
| GREEN | `feat: add start N IPC for ad-hoc work sessions` | same | 237 tests, 237 pass |
| Coverage | | CI coverage command (80% gate on `Model.js`) | 100% lines, 97.5% branches, 100% functions |
| Lint | | `/usr/lib/qt6/bin/qmllint *.qml` | no errors |

## What the tests guarantee
| # | Guarantee | Test | Type |
|---|---|---|---|
| 1 | From idle, `start N` begins N min of running work | ad-hoc sessions › from idle… | unit |
| 2 | `0` or no number uses the configured work length | ad-hoc sessions › 0, or no number… | unit |
| 3 | Over 180 is clamped; negative or junk falls back | ad-hoc sessions › over 180 is clamped… | unit |
| 4 | Awaiting work: starts work of N min, cycle kept | ad-hoc sessions › while awaiting work… | unit |
| 5 | Awaiting short break: skips it, cycle unchanged | ad-hoc sessions › …short break… | unit |
| 6 | Awaiting long break: skips it and closes the cycle | ad-hoc sessions › …long break… | unit |
| 7 | Running or paused: returns the identical state (→ `busy`) | ad-hoc sessions › while running or paused… | unit |
| 8 | A finished custom session adds 1 session and N min to stats | ad-hoc sessions › …counts in stats… | unit |
| 9 | Back keeps a custom or adjusted length | ad-hoc sessions › back … | unit |
| 10 | IPC exposes `start(minutes: int): string` and the README documents it | IPC › exposes start, start takes typed…, README documents every command | contract |

## Known gaps
- The `Service.start` busy/ok wiring and the live IPC call can't run under node. Check them by hand: `omarchy restart shell`, then `omarchy-shell pomarchy start 2` and `status` (remainingMs ≈ 120000), then `start 5` → `busy`.
