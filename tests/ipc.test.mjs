// Contract test for the IPC surface documented in the README. QML can't be
// executed under node, so this checks the handler declared in Service.qml and
// that every documented command exists (and vice versa).
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"

const service = readFileSync(new URL("../Service.qml", import.meta.url), "utf8")
const readmeUrl = new URL("../README.md", import.meta.url)
const COMMANDS = ["toggle", "confirm", "skip", "back", "stop", "reset", "adjust", "start", "status"]

function ipcBlock(source) {
  const start = source.indexOf("IpcHandler {")
  return start === -1 ? "" : source.slice(start)
}

describe("IPC", () => {
  test("Service.qml registers the pomarchy target", () => {
    assert.match(ipcBlock(service), /target:\s*"pomarchy"/)
  })

  for (const name of COMMANDS) {
    test(`exposes ${name}`, () => {
      assert.match(ipcBlock(service), new RegExp(`function ${name}\\(`))
    })
  }

  test("adjust takes typed whole minutes", () => {
    assert.match(ipcBlock(service), /function adjust\(minutes:\s*int\):\s*string/)
  })

  test("start takes typed whole minutes and reports busy", () => {
    assert.match(ipcBlock(service), /function start\(minutes:\s*int\):\s*string/)
  })

  test("README documents every command", () => {
    assert.ok(existsSync(readmeUrl), "README.md missing")
    const readme = readFileSync(readmeUrl, "utf8")
    for (const name of COMMANDS) assert.match(readme, new RegExp(`omarchy-shell pomarchy ${name}`), name)
  })
})
