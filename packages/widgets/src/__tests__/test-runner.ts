/**
 * Lightweight test harness for GJS unit tests with async support.
 *
 * Does NOT use GLib.Test (segfaults in some GJS versions).
 * Sync tests run in a loop; async tests are awaited with a timeout.
 *
 * Usage:
 *   import { describe, it, expect, run } from "./test-runner"
 *
 *   describe("MyService", () => {
 *     it("should do X", () => {
 *       expect(actual).toBe(expected)
 *     })
 *     it.async("should fetch data", async () => {
 *       const result = await someAsyncOp()
 *       expect(result).toBe(42)
 *     })
 *   })
 *
 *   // At end of file:
 *   run(import.meta.url)
 */

type TestFn = () => void | Promise<void>;

let currentSuite = '';
const suites: Array<{
    suite: string;
    tests: Array<{name: string; fn: TestFn; isAsync: boolean}>;
}> = [];

export function describe(name: string, fn: () => void) {
    currentSuite = name;
    fn();
    currentSuite = '';
}

export function it(name: string, fn: () => void) {
    addTest(name, fn, false);
}

it.async = function (name: string, fn: () => Promise<void>) {
    addTest(name, fn, true);
};

function addTest(name: string, fn: TestFn, isAsync: boolean) {
    let entry = suites.find(s => s.suite === currentSuite);
    if (!entry) {
        entry = {suite: currentSuite, tests: []};
        suites.push(entry);
    }
    entry.tests.push({name, fn, isAsync});
}

export const expect = (actual: unknown) => ({
    toBe: (expected: unknown) => {
        if (actual !== expected) {
            throw new Error(
                `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
            );
        }
    },
    toEqual: (expected: unknown) => {
        const a = JSON.stringify(actual);
        const e = JSON.stringify(expected);
        if (a !== e) {
            throw new Error(`Expected ${e}, got ${a}`);
        }
    },
    toBeGreaterThan: (expected: number) => {
        if (typeof actual !== 'number' || actual <= expected) {
            throw new Error(`Expected > ${expected}, got ${actual}`);
        }
    },
    toBeLessThan: (expected: number) => {
        if (typeof actual !== 'number' || actual >= expected) {
            throw new Error(`Expected < ${expected}, got ${actual}`);
        }
    },
    toBeTruthy: () => {
        if (!actual) throw new Error(`Expected truthy, got ${actual}`);
    },
    toBeFalsy: () => {
        if (actual) throw new Error(`Expected falsy, got ${actual}`);
    },
    toBeNull: () => {
        if (actual !== null)
            throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
    },
    toBeDefined: () => {
        if (actual === undefined)
            throw new Error(`Expected defined, got undefined`);
    },
    toContain: (expected: unknown) => {
        if (!Array.isArray(actual)) throw new Error('Expected array');
        if (!actual.includes(expected)) {
            throw new Error(
                `Expected [${actual}] to contain ${JSON.stringify(expected)}`
            );
        }
    },
    toThrow: () => {
        if (typeof actual !== 'function')
            throw new Error('Expected a function');
        let threw = false;
        try {
            actual();
        } catch {
            threw = true;
        }
        if (!threw) throw new Error('Expected function to throw');
    },
    toThrowMatching: (predicate: (e: unknown) => boolean) => {
        if (typeof actual !== 'function')
            throw new Error('Expected a function');
        let threw = false;
        let error: unknown = null;
        try {
            actual();
        } catch (e) {
            threw = true;
            error = e;
        }
        if (!threw) throw new Error('Expected function to throw');
        if (!predicate(error)) {
            throw new Error(`Exception didn't match predicate: ${error}`);
        }
    },
});

const ASYNC_TIMEOUT_MS = 5000;

export async function run(_importMetaUrl?: string) {
    let passed = 0;
    let failed = 0;

    for (const {suite, tests} of suites) {
        for (const {name, fn, isAsync} of tests) {
            const label = `${suite} → ${name}`;
            try {
                if (isAsync) {
                    await Promise.race([
                        fn() as Promise<void>,
                        new Promise<never>((_, reject) =>
                            setTimeout(
                                () =>
                                    reject(
                                        new Error(
                                            `Timeout after ${ASYNC_TIMEOUT_MS}ms`
                                        )
                                    ),
                                ASYNC_TIMEOUT_MS
                            )
                        ),
                    ]);
                } else {
                    fn();
                }
                passed++;
                print(`  ✓ ${label}`);
            } catch (e) {
                failed++;
                print(`  ✗ ${label}`);
                print(`    ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }

    const total = passed + failed;
    print(
        `\n${passed}/${total} passed` + (failed > 0 ? `, ${failed} FAILED` : '')
    );

    if (failed > 0) {
        imports.system.exit(1);
    }
}
