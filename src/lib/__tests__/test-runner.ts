/**
 * Thin test harness wrapping GLib.Test for GJS unit tests.
 *
 * Usage:
 *   import { describe, it, expect, run } from "./test-runner"
 *
 *   describe("MyService", () => {
 *     it("should do X", () => {
 *       expect(actual).toBe(expected)
 *     })
 *   })
 *
 *   // At end of file:
 *   run(import.meta.url)
 *
 * Run with: gjs -m src/lib/__tests__/myfile.test.ts
 */

import GLib from "gi://GLib?version=2.0"

let currentSuite = "root"
let testCount = 0
let failCount = 0
const suites: Record<string, Array<{ name: string; fn: () => void }>> = {}

export function describe(name: string, fn: () => void) {
  currentSuite = name
  suites[name] = []
  fn()
  currentSuite = "root"
}

export function it(name: string, fn: () => void) {
  const suite = suites[currentSuite] || []
  suite.push({ name, fn })
  suites[currentSuite] = suite
}

export const expect = (actual: unknown) => ({
  toBe: (expected: unknown) => {
    if (actual !== expected) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
  },
  toEqual: (expected: unknown) => {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a !== e) {
      throw new Error(`Expected ${e}, got ${a}`)
    }
  },
  toBeGreaterThan: (expected: number) => {
    if (typeof actual !== "number" || actual <= expected) {
      throw new Error(`Expected > ${expected}, got ${actual}`)
    }
  },
  toBeLessThan: (expected: number) => {
    if (typeof actual !== "number" || actual >= expected) {
      throw new Error(`Expected < ${expected}, got ${actual}`)
    }
  },
  toBeTruthy: () => {
    if (!actual) throw new Error(`Expected truthy, got ${actual}`)
  },
  toBeFalsy: () => {
    if (actual) throw new Error(`Expected falsy, got ${actual}`)
  },
  toThrow: () => {
    if (typeof actual !== "function") throw new Error("Expected a function")
    let threw = false
    try {
      actual()
    } catch {
      threw = true
    }
    if (!threw) throw new Error("Expected function to throw")
  },
})

export function run(importMetaUrl: string) {
  const filePath = importMetaUrl.replace("file://", "")

  for (const [suiteName, tests] of Object.entries(suites)) {
    for (const { name, fn } of tests) {
      const testPath = `/${suiteName}/${name}`
      testCount++
      GLib.test_add_func(testPath, () => {
        try {
          fn()
        } catch (e) {
          failCount++
          throw e
        }
      })
    }
  }

  print(`\n─── Running ${testCount} test(s) in ${filePath.split("/").pop()} ───\n`)

  const result = GLib.test_run()

  const passed = testCount - failCount
  print(`\n${passed}/${testCount} passed${failCount > 0 ? `, ${failCount} FAILED` : ""}`)

  if (failCount > 0) {
    // Exit with failure code so CI catches it
    imports.system.exit(1)
  }
}
