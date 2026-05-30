/**
 * Lightweight test harness for GJS unit tests.
 *
 * Does NOT use GLib.Test (segfaults in some GJS versions).
 * Instead runs tests synchronously via a simple loop.
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
 * Run: gjs -m <compiled-test-file>.js
 */

let currentSuite = ""
const suites: Array<{ suite: string; tests: Array<{ name: string; fn: () => void }> }> = []

export function describe(name: string, fn: () => void) {
  currentSuite = name
  fn()
  currentSuite = ""
}

export function it(name: string, fn: () => void) {
  let entry = suites.find((s) => s.suite === currentSuite)
  if (!entry) {
    entry = { suite: currentSuite, tests: [] }
    suites.push(entry)
  }
  entry.tests.push({ name, fn })
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

export function run(importMetaUrl?: string) {
  let passed = 0
  let failed = 0

  for (const { suite, tests } of suites) {
    for (const { name, fn } of tests) {
      const label = `${suite} → ${name}`
      try {
        fn()
        passed++
        print(`  ✓ ${label}`)
      } catch (e) {
        failed++
        print(`  ✗ ${label}`)
        print(`    ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const total = passed + failed
  print(`\n${passed}/${total} passed` + (failed > 0 ? `, ${failed} FAILED` : ""))

  if (failed > 0) {
    // Exit with failure code so CI catches it
    imports.system.exit(1)
  }
}
