// Contract tests for manifest.json: what the Omarchy shell needs to discover,
// mount, and configure the plugin, and that its defaults agree with Model.js.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const root = fileURLToPath(new URL("..", import.meta.url))
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"))
const Model = vm.createContext({})
vm.runInContext(readFileSync(new URL("../Model.js", import.meta.url), "utf8"), Model)

const TIMER_KEYS = ["workMinutes", "shortBreakMinutes", "longBreakMinutes", "sessionsBeforeLongBreak"]

describe("manifest", () => {
  test("identifies the plugin", () => {
    assert.equal(manifest.schemaVersion, 1)
    assert.equal(manifest.id, "nambrosini.pomodoro")
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  })

  test("ships one shared service plus a bar widget", () => {
    assert.deepEqual([...manifest.kinds].sort(), ["bar-widget", "service"])
    assert.equal(manifest.entryPoints.service, "Service.qml")
    assert.equal(manifest.entryPoints.barWidget, "BarWidget.qml")
  })

  test("entry points exist on disk", () => {
    for (const file of Object.values(manifest.entryPoints)) assert.ok(existsSync(root + file), file)
  })

  test("the service reloads with code changes (state is persisted instead)", () => {
    assert.notEqual(manifest.keepLoaded, true)
  })

  test("only one widget instance per bar layout", () => {
    assert.equal(manifest.barWidget.allowMultiple, false)
  })

  test("schema exposes every timer setting", () => {
    const keys = manifest.barWidget.schema.map((field) => field.key)
    for (const key of TIMER_KEYS) assert.ok(keys.includes(key), key)
  })

  test("schema defaults match barWidget.defaults", () => {
    for (const field of manifest.barWidget.schema)
      assert.deepEqual(manifest.barWidget.defaults[field.key], field.defaultValue, field.key)
  })

  test("defaults agree with the model's built-in fallbacks", () => {
    assert.deepEqual(
      JSON.parse(JSON.stringify(Model.normalizeConfig(manifest.barWidget.defaults))),
      JSON.parse(JSON.stringify(Model.normalizeConfig({}))),
    )
  })

  test("schema exposes the alert settings", () => {
    const byKey = Object.fromEntries(manifest.barWidget.schema.map((field) => [field.key, field]))
    assert.equal(byKey.notify?.type, "boolean")
    assert.equal(byKey.sound?.type, "path")
  })

  test("integer fields stay within the model's limits", () => {
    for (const field of manifest.barWidget.schema.filter((f) => f.type === "integer")) {
      assert.ok(field.min >= 1, field.key)
      assert.ok(field.max <= 180, field.key)
    }
  })

  test("passes omarchy plugin validate", { skip: !existsSync("/usr/bin/omarchy") && "omarchy not installed" }, () => {
    const out = execFileSync("omarchy", ["plugin", "validate", root], { encoding: "utf8" })
    assert.doesNotMatch(out, /fail|error/i)
  })
})
