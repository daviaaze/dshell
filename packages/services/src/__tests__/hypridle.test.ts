/**
 * Smoke tests for Hypridle service.
 *
 * Tests singleton pattern, default values, setter clamping,
 * cross-validation, and double-init guard.
 *
 * These tests do NOT require hypridle or AGS Process to be installed —
 * they validate the logic and state management only.
 *
 * Run: gjs -m src/lib/__tests__/hypridle.test.ts
 */

import Hypridle from '../power/hypridle';
import {describe, expect, it, run} from './test-runner';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a gnim-compatible Accessor<T> (callable function + .subscribe).
 * Pass `override` to return a custom value; subscribe is a no-op.
 */
function mockAccessor<T>(override?: T): import('gnim').Accessor<T> {
    const fn = (() => override) as import('gnim').Accessor<T>;
    fn.subscribe = () => () => {};
    return fn;
}

/** Minimal mock settings object for init() */
function mockSettings(overrides: Record<string, unknown> = {}) {
    return {
        autoLockEnabled: mockAccessor((overrides.autoLockEnabled as boolean) ?? true),
        idleTimeout: mockAccessor((overrides.idleTimeout as number) ?? 300),
        screenDimEnabled: mockAccessor((overrides.screenDimEnabled as boolean) ?? true),
        screenDimTimeout: mockAccessor((overrides.screenDimTimeout as number) ?? 240),
        dpmsEnabled: mockAccessor((overrides.dpmsEnabled as boolean) ?? true),
        dpmsTimeout: mockAccessor((overrides.dpmsTimeout as number) ?? 600),
        suspendEnabled: mockAccessor((overrides.suspendEnabled as boolean) ?? false),
        suspendTimeout: mockAccessor((overrides.suspendTimeout as number) ?? 1800),
        setAutoLockEnabled: () => {},
        setIdleTimeout: () => {},
        setScreenDimEnabled: () => {},
        setScreenDimTimeout: () => {},
        setDpmsEnabled: () => {},
        setDpmsTimeout: () => {},
        setSuspendEnabled: () => {},
        setSuspendTimeout: () => {},
    };
}

// ── Singleton ───────────────────────────────────────────────────────────────

describe('Hypridle.get_default', () => {
    it('returns the same instance', () => {
        const a = Hypridle.get_default();
        const b = Hypridle.get_default();
        expect(a).toBe(b);
    });

    it('returns a Hypridle instance', () => {
        const h = Hypridle.get_default();
        expect(h instanceof Hypridle).toBeTruthy();
    });
});

// ── Default Values ──────────────────────────────────────────────────────────

describe('Hypridle default values', () => {
    it('has enabled=true by default', () => {
        const h = Hypridle.get_default();
        expect(h.enabled).toBe(true);
    });

    it('has idleTimeout=300 by default', () => {
        const h = Hypridle.get_default();
        expect(h.idleTimeout).toBe(300);
    });

    it('has dimTimeout=240 by default', () => {
        const h = Hypridle.get_default();
        expect(h.dimTimeout).toBe(240);
    });

    it('has dimEnabled=true by default', () => {
        const h = Hypridle.get_default();
        expect(h.dimEnabled).toBe(true);
    });

    it('has dpmsTimeout=600 by default', () => {
        const h = Hypridle.get_default();
        expect(h.dpmsTimeout).toBe(600);
    });

    it('has dpmsEnabled=true by default', () => {
        const h = Hypridle.get_default();
        expect(h.dpmsEnabled).toBe(true);
    });

    it('has suspendEnabled=false by default', () => {
        const h = Hypridle.get_default();
        expect(h.suspendEnabled).toBe(false);
    });

    it('has suspendTimeout=1800 by default', () => {
        const h = Hypridle.get_default();
        expect(h.suspendTimeout).toBe(1800);
    });
});

// ── Setter Clamping ─────────────────────────────────────────────────────────

describe('Hypridle idleTimeout setter', () => {
    it('clamps minimum to 60', () => {
        const h = Hypridle.get_default();
        h.idleTimeout = 10;
        expect(h.idleTimeout).toBe(60);
    });

    it('clamps maximum to 1800', () => {
        const h = Hypridle.get_default();
        h.idleTimeout = 9999;
        expect(h.idleTimeout).toBe(1800);
    });

    it('accepts valid value', () => {
        const h = Hypridle.get_default();
        h.idleTimeout = 600;
        expect(h.idleTimeout).toBe(600);
    });
});

describe('Hypridle dimTimeout setter', () => {
    it('clamps minimum to 30', () => {
        const h = Hypridle.get_default();
        h.idleTimeout = 300;
        h.dimTimeout = 5;
        expect(h.dimTimeout).toBe(30);
    });

    it('clamps to idleTimeout - 10', () => {
        const h = Hypridle.get_default();
        h.idleTimeout = 300;
        h.dimTimeout = 295;
        expect(h.dimTimeout).toBe(290);
    });
});

describe('Hypridle dpmsTimeout setter', () => {
    it('clamps minimum to idleTimeout + 10', () => {
        const h = Hypridle.get_default();
        h.idleTimeout = 300;
        h.dpmsTimeout = 200;
        expect(h.dpmsTimeout).toBe(310);
    });

    it('clamps maximum to 3600', () => {
        const h = Hypridle.get_default();
        h.idleTimeout = 300;
        h.dpmsTimeout = 9999;
        expect(h.dpmsTimeout).toBe(3600);
    });
});

describe('Hypridle suspendTimeout setter', () => {
    it('clamps minimum to dpmsTimeout + 10', () => {
        const h = Hypridle.get_default();
        h.idleTimeout = 300;
        h.dpmsTimeout = 600;
        h.suspendTimeout = 400;
        expect(h.suspendTimeout).toBe(610);
    });

    it('clamps maximum to 7200', () => {
        const h = Hypridle.get_default();
        h.idleTimeout = 300;
        h.dpmsTimeout = 600;
        h.suspendTimeout = 99999;
        expect(h.suspendTimeout).toBe(7200);
    });
});

// ── Cross-Validation ────────────────────────────────────────────────────────

describe('Hypridle cross-validation', () => {
    it('adjusts dimTimeout when idleTimeout is lowered below it', () => {
        const h = Hypridle.get_default();
        h.idleTimeout = 600;
        h.dimTimeout = 500;
        // Now lower idleTimeout below dimTimeout
        h.idleTimeout = 100;
        // dimTimeout should be clamped to idleTimeout - 10
        expect(h.dimTimeout).toBe(90);
    });

    it('adjusts dpmsTimeout when idleTimeout is raised above it', () => {
        const h = Hypridle.get_default();
        h.idleTimeout = 300;
        h.dpmsTimeout = 600;
        // Raise idleTimeout above dpmsTimeout
        h.idleTimeout = 700;
        // dpmsTimeout should be clamped to idleTimeout + 10
        expect(h.dpmsTimeout).toBe(710);
    });

    it('adjusts suspendTimeout when dpmsTimeout is raised above it', () => {
        const h = Hypridle.get_default();
        h.idleTimeout = 300;
        h.dpmsTimeout = 600;
        h.suspendTimeout = 900;
        // Raise dpmsTimeout above suspendTimeout
        h.dpmsTimeout = 1000;
        // suspendTimeout should be clamped to dpmsTimeout + 10
        expect(h.suspendTimeout).toBe(1010);
    });

    it('maintains chain dim < idle < dpms < suspend after idle setter', () => {
        const h = Hypridle.get_default();
        // Set a valid chain
        h.idleTimeout = 600;
        const dim = h.dimTimeout;
        const idle = h.idleTimeout;
        const dpms = h.dpmsTimeout;
        const suspend = h.suspendTimeout;

        expect(dim < idle).toBeTruthy();
        expect(idle < dpms).toBeTruthy();
        expect(dpms < suspend).toBeTruthy();
    });
});

// ── Enabled Setter ──────────────────────────────────────────────────────────

describe('Hypridle enabled setter', () => {
    it('toggles enabled state', () => {
        const h = Hypridle.get_default();
        h.enabled = false;
        expect(h.enabled).toBe(false);
        h.enabled = true;
        expect(h.enabled).toBe(true);
    });
});

// ── Init / Double-Init ──────────────────────────────────────────────────────

describe('Hypridle init', () => {
    it('reads all 8 values from settings on first init', () => {
        const h = Hypridle.get_default();
        const s = mockSettings({
            autoLockEnabled: false,
            idleTimeout: 400,
            screenDimEnabled: false,
            screenDimTimeout: 200,
            dpmsEnabled: false,
            dpmsTimeout: 500,
            suspendEnabled: true,
            suspendTimeout: 2000,
        });
        h.init(s);
        expect(h.enabled).toBe(false);
        expect(h.idleTimeout).toBe(400);
        expect(h.dimEnabled).toBe(false);
        expect(h.dimTimeout).toBe(200);
        expect(h.dpmsEnabled).toBe(false);
        expect(h.dpmsTimeout).toBe(500);
        expect(h.suspendEnabled).toBe(true);
        expect(h.suspendTimeout).toBe(2000);
    });

    it('guards against double-init', () => {
        const h = Hypridle.get_default();
        // Already initialized from previous test — init should skip
        const s = mockSettings({idleTimeout: 500});
        h.init(s);
        // Values should NOT change because init was skipped
        expect(h.idleTimeout).toBe(400);
    });
});

// ── Dispose ─────────────────────────────────────────────────────────────────

describe('Hypridle dispose', () => {
    it('does not throw when called', () => {
        const h = Hypridle.get_default();
        // dispose should not throw even with null process/state
        let threw = false;
        try {
            h.dispose();
        } catch {
            threw = true;
        }
        expect(threw).toBe(false);
    });
});

await run(import.meta.url);
