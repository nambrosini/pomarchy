// Source guards for BarWidget.qml. QML can't run under node; these pin the
// fix for a bug found in review: an imperative `button.opacity = …` replaced
// WidgetButton's own opacity binding, so a paused timer stopped dimming after
// the first phase-change pulse. Verified live by screenshot.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const widget = readFileSync(new URL("../BarWidget.qml", import.meta.url), "utf8")

describe("BarWidget pulse", () => {
  test("never assigns the button's opacity imperatively", () => {
    assert.doesNotMatch(widget, /button\.opacity\s*=/)
  })

  test("pulses the widget root, outside WidgetButton", () => {
    const pulse = widget.indexOf("SequentialAnimation on opacity")
    const button = widget.indexOf("WidgetButton {")
    assert.ok(pulse !== -1, "pulse animation missing")
    assert.ok(pulse < button, "pulse is declared inside WidgetButton")
  })
})

// The popup plan: the bar keeps its label, icon and pulse, but the only
// action left on it is a left click that opens or closes the popup.
describe("BarWidget hosts the popup", () => {
  const pressed = widget.slice(widget.indexOf("onPressed"), widget.indexOf("onPressed") + 400)

  test("no scroll handling", () => {
    assert.doesNotMatch(widget, /onWheelMoved/)
  })

  test("no timer actions from the bar", () => {
    assert.doesNotMatch(widget, /service\.(skip|reset|adjust|toggle|confirm|back|stop|next)\(/)
  })

  test("a left click toggles the panel and other buttons do nothing", () => {
    assert.match(pressed, /Qt\.LeftButton/)
    assert.match(pressed, /togglePanel\(\)/)
    assert.doesNotMatch(pressed, /RightButton|MiddleButton/)
  })

  test("loads Panel.qml and hands it the service", () => {
    assert.match(widget, /Loader\s*{[\s\S]*?Qt\.resolvedUrl\("Panel\.qml"\)/)
    assert.match(widget, /function injectPanel\(\)[\s\S]*?target\.service\s*=\s*root\.service/)
  })

  test("exposes the shape Bar.findPanelWidget needs", () => {
    for (const name of ["open", "close", "togglePanel", "closeForPopoutSwitch"])
      assert.match(widget, new RegExp(`function ${name}\\(\\)`), name)
    assert.match(widget, /readonly property bool opened:/)
    assert.match(widget, /readonly property bool popoutSwitchClosing:/)
    assert.match(widget, /openPanelIndicatorWidth/)
  })
})
