/**
 * Tests for DeferredSingleton — pure TypeScript, no GObject deps.
 *
 * Run: gjs -m src/lib/__tests__/deferredSingleton.test.ts
 */
import {describe, it, expect, run} from './test-runner';
import {DeferredSingleton} from '../core/deferredSingleton';

describe('DeferredSingleton', () => {
    it('returns the factory result on first get()', () => {
        const s = new DeferredSingleton(() => 42);
        expect(s.get()).toBe(42);
    });

    it('caches the result on subsequent calls', () => {
        let calls = 0;
        const s = new DeferredSingleton(() => {
            calls++;
            return 'cached';
        });
        expect(s.get()).toBe('cached');
        expect(s.get()).toBe('cached');
        expect(s.get()).toBe('cached');
        expect(calls).toBe(1);
    });

    it('returns null while initializing (re-entrancy guard)', () => {
        const s = new DeferredSingleton(() => {
            // During init, concurrent callers should get null
            return s.get(); // recursive call
        });
        // The recursive call during init returns null via the guard
        const result = s.get();
        // After init completes, result is cached (null in this case
        // because the factory tried to call get() recursively which
        // returned null, so the factory returned null)
        expect(result).toBe(null);
    });

    it('returns null on factory error', () => {
        const s = new DeferredSingleton<string>(() => {
            throw new Error('boom');
        });
        expect(s.get()).toBe(null);
        expect(s.get()).toBe(null); // still null after error
    });

    it('calls onError callback on factory failure', () => {
        let errorCaught: unknown = null;
        const s = new DeferredSingleton(
            () => {
                throw new Error('fail');
            },
            e => {
                errorCaught = e;
            }
        );
        s.get();
        expect(errorCaught).not.toBe(null);
    });

    it('reports initialized state correctly', () => {
        const s = new DeferredSingleton(() => 'hello');
        expect(s.initialized).toBe(false);
        s.get();
        expect(s.initialized).toBe(true);
    });

    it('reset() allows re-initialization', () => {
        let calls = 0;
        const s = new DeferredSingleton(() => {
            calls++;
            return calls;
        });
        expect(s.get()).toBe(1);
        expect(s.initialized).toBe(true);
        s.reset();
        expect(s.initialized).toBe(false);
        expect(s.get()).toBe(2);
    });

    it('handles null as a valid factory result', () => {
        const s = new DeferredSingleton<number | null>(() => null);
        expect(s.get()).toBe(null);
        expect(s.initialized).toBe(true);
        // Cannot distinguish "factory returned null" from "error produced null"
        // but both cases return null which is the intended API
    });
});

await run();
