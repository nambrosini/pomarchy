// Source guards for the popup (Panel.qml and its local components). QML
// can't run under node, so these pin the decisions from the plan that a
// refactor could silently undo; the rest is checked live.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"

const read = (name) => {
  const url = new URL(`../${name}`, import.meta.url)
  return existsSync(url) ? readFileSync(url, "utf8") : ""
}
const panel = read("Panel.qml")
const section = read("CollapsibleSection.qml")
const ring = read("ProgressRing.qml")
const service = read("Service.qml")

describe("Service feeds the popup", () => {
  test("exposes the panel view model", () => {
    assert.match(service, /readonly property var panelView:\s*Model\.panelView\(timerState, config, now\)/)
  })

  for (const name of ["back", "stop", "next"]) {
    test(`has a ${name} action`, () => {
      assert.match(service, new RegExp(`function ${name}\\(\\)\\s*{\\s*root\\.now = Date\\.now\\(\\); root\\.apply\\(Model\\.${name}\\(`))
    })
  }

  test("restore gets the config (old-file migration) and the clock (history pruning)", () => {
    assert.match(service, /Model\.restore\([^)]*\),\s*root\.config,\s*Date\.now\(\)\)/)
  })
})

describe("Panel", () => {
  test("exists and is a keyboard panel anchored on the bar widget", () => {
    assert.match(panel, /^Panel\s*{/m)
    assert.match(panel, /KeyboardPanel\s*{/)
    assert.match(panel, /owner:\s*root\.barIdentity/)
    assert.match(panel, /fittedContentHeight\(/)
  })

  test("binds to the service's panelView", () => {
    assert.match(panel, /property var service/)
    assert.match(panel, /service\.panelView/)
  })

  test("has back, play/pause, next and stop, gated by panelView", () => {
    for (const action of ["back", "toggle", "next", "stop"])
      assert.match(panel, new RegExp(`service\\.${action}\\(\\)`), action)
    for (const gate of ["canBack", "canNext", "canStop"]) assert.match(panel, new RegExp(gate), gate)
  })

  test("Settings and Shortcuts are collapsible and never start expanded", () => {
    assert.equal((panel.match(/CollapsibleSection\s*{/g) || []).length, 2)
    assert.doesNotMatch(panel, /expanded:\s*true/)
    assert.match(section, /property bool expanded:\s*false/)
  })

  test("duration chips come from the model's choices", () => {
    assert.match(panel, /Model\.durationOptions\(/)
    assert.match(panel, /Model\.chipValue\(/)
    assert.match(panel, /Model\.customNote\(/)
    assert.match(panel, /Model\.stepCycles\(/)
  })

  test("settings changes are written back through the shell", () => {
    assert.match(panel, /function persistSettings\(/)
    assert.match(panel, /updateEntryInline\(root\.moduleName, entry\)/)
  })

  test("popup keys: space/enter play-pause, arrows and h/l back/next, s stop, esc close", () => {
    assert.match(panel, /onActivateRequested:\s*root\.service\.toggle\(\)|onActivateRequested:[^\n]*toggle/)
    assert.match(panel, /onMoveRequested:[\s\S]*?dx < 0[\s\S]*?back\(\)[\s\S]*?next\(\)/)
    assert.match(panel, /onTextKey:[\s\S]*?"s"[\s\S]*?stop\(\)/)
    // Esc closes from the timer (from stats it goes back first, see "Stats view").
    assert.match(panel, /onCloseRequested:[\s\S]*?else root\.close\(\)/)
  })

  test("the shortcuts list matches the keys", () => {
    for (const key of ["Space", "h", "l", "s", "Esc"]) assert.match(panel, new RegExp(`"${key}`), key)
  })
})

describe("ProgressRing", () => {
  test("draws a track and a value arc with round caps", () => {
    assert.equal((ring.match(/PathAngleArc\s*{/g) || []).length, 2)
    assert.match(ring, /ShapePath\.RoundCap/)
    assert.match(ring, /Behavior on progress/)
  })
})

describe("Panel folding", () => {
  test("both sections fold again whenever the popup closes", () => {
    assert.match(panel, /onOpenedChanged:\s*if \(!opened\)\s*{[\s\S]*?settingsSection\.expanded = false[\s\S]*?shortcutsSection\.expanded = false/)
  })
})

// ---- Stats

const graph = read("ContributionGraph.qml")

describe("Service keeps the stats archive", () => {
  const statsFile = service.slice(service.indexOf("id: statsFile"), service.indexOf("id: statsFile") + 500)

  test("stats.json is its own atomic FileView next to state.json", () => {
    assert.match(statsFile, /path:\s*root\.stateDir \+ "\/stats\.json"/)
    assert.match(statsFile, /atomicWrites:\s*true/)
    assert.match(statsFile, /onLoadFailed:\s*root\.loadStats\(""\)/)
  })

  test("the archive loads only after the timer state (seeding needs its history)", () => {
    assert.match(service, /function loadStats\(fileText\)\s*{[\s\S]*?if \(root\.statsLoaded \|\| !root\.stateLoaded/)
    assert.match(service, /Model\.loadStats\(/)
  })

  test("a corrupt archive is copied aside before it is replaced", () => {
    assert.match(service, /\.backup\)[\s\S]*?"cp", statsFile\.path, statsFile\.path \+ "\.bad-"/)
  })

  test("apply() feeds the archive from the state change, once it has loaded", () => {
    assert.match(service, /function apply\(next\)[\s\S]*?Model\.statsDelta\(previous, next, root\.now\)[\s\S]*?root\.statsLoaded/)
    assert.match(service, /Model\.applyStatsDelta\(/)
  })

  test("the graph keys off the day, not the 500 ms tick", () => {
    assert.match(service, /readonly property string todayKey:\s*Model\.dayKey\(now\)/)
  })
})

describe("Stats view", () => {
  test("a stats button and the g key switch the popup to stats", () => {
    assert.match(panel, /property string view:\s*"timer"/)
    assert.match(panel, /tooltipText:\s*"Stats"/)
    assert.match(panel, /t === "g"[\s\S]*?toggleStats\(\)/)
  })

  test("the popup reopens on the timer, showing the current year", () => {
    assert.match(panel, /onOpenedChanged:\s*if \(!opened\)\s*{[\s\S]*?root\.view = "timer"[\s\S]*?root\.statsEnd = ""/)
  })

  test("timer keys don't fire in stats: arrows page years, Esc goes back", () => {
    assert.match(panel, /onMoveRequested:[\s\S]*?root\.view === "stats"[\s\S]*?pageYear\(/)
    assert.match(panel, /onCloseRequested:[\s\S]*?root\.view === "stats"\s*\?\s*root\.view = "timer"|onCloseRequested:[\s\S]*?if \(root\.view === "stats"\) root\.view = "timer"/)
    assert.match(panel, /onActivateRequested:[\s\S]*?root\.view === "timer"/)
  })

  test("the popup widens for the graph", () => {
    assert.match(panel, /fittedContentWidth\(root\.view === "stats"/)
  })

  test("graph, summary and paging come from the model", () => {
    assert.match(panel, /Model\.contributionGrid\(/)
    assert.match(panel, /Model\.statsSummary\(/)
    assert.match(panel, /Model\.shiftYear\(/)
    assert.match(panel, /ContributionGraph\s*{/)
    assert.match(panel, /Sessions are counted from/)
  })

  test("the shortcuts list includes g", () => {
    assert.match(panel, /key:\s*"g"/)
  })
})

describe("ContributionGraph", () => {
  test("renders weeks of day cells with labels, tooltips and a legend", () => {
    assert.match(graph, /property var grid/)
    assert.match(graph, /grid\.weeks/)
    assert.match(graph, /grid\.monthLabels/)
    assert.match(graph, /grid\.dayLabels/)
    assert.match(graph, /Model\.dayTooltip\(/)
    assert.match(graph, /PanelToolTip/)
    assert.match(graph, /"less"[\s\S]*?"more"/)
  })
})
