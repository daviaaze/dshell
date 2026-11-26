/**
 * Tests for the idle timeout chain: the pure normaliser and the Hypridle
 * service's write-back of every key it changes.
 *
 * Run: pnpm run test:compile && nix develop -c gjs -m build/test/hypridleConfig.test.js
 */

import type {Accessor} from 'gnim';
import Hypridle from '../power/hypridle';
import {buildHypridleConfigLines, normaliseTimeouts} from '../power/hypridleConfig';
import {describe, expect, it, run} from './test-runner';

function mockAccessor<T>(value: T): Accessor<T> {
    const fn = (() => value) as Accessor<T>;
    fn.subscribe = () => () => {};
    return fn;
}

/** Initialise a fresh service from stored values and record every GSettings write. */
function initWith(stored: {
    idle: number;
    dim: number;
    dpms: number;
    suspend: number;
    suspendEnabled: boolean;
}) {
    const writes: Record<string, number | boolean> = {};
    const h = new Hypridle();
    h.init(
        {
            autoLockEnabled: mockAccessor(true),
            idleTimeout: mockAccessor(stored.idle),
            screenDimEnabled: mockAccessor(true),
            screenDimTimeout: mockAccessor(stored.dim),
            dpmsEnabled: mockAccessor(true),
            dpmsTimeout: mockAccessor(stored.dpms),
            suspendEnabled: mockAccessor(stored.suspendEnabled),
            suspendTimeout: mockAccessor(stored.suspend),
            setAutoLockEnabled: (v) => {
                writes.autoLock = v;
            },
            setIdleTimeout: (v) => {
                writes.idle = v;
            },
            setScreenDimEnabled: (v) => {
                writes.dimEnabled = v;
            },
            setScreenDimTimeout: (v) => {
                writes.dim = v;
            },
            setDpmsEnabled: (v) => {
                writes.dpmsEnabled = v;
            },
            setDpmsTimeout: (v) => {
                writes.dpms = v;
            },
            setSuspendEnabled: (v) => {
                writes.suspendEnabled = v;
            },
            setSuspendTimeout: (v) => {
                writes.suspend = v;
            },
        },
        {available: false}
    );
    return {h, writes};
}

describe('normaliseTimeouts', () => {
    it('keeps a valid chain unchanged', () => {
        const chain = {idleTimeout: 300, dimTimeout: 240, dpmsTimeout: 600, suspendTimeout: 1800};
        expect(normaliseTimeouts(chain)).toEqual(chain);
    });

    it('pushes dpms and suspend up in order when idle rises past them', () => {
        expect(
            normaliseTimeouts({
                idleTimeout: 1790,
                dimTimeout: 240,
                dpmsTimeout: 600,
                suspendTimeout: 1800,
            })
        ).toEqual({idleTimeout: 1790, dimTimeout: 240, dpmsTimeout: 1800, suspendTimeout: 1810});
    });

    it('pulls dim below idle and clamps every tier to its range', () => {
        expect(
            normaliseTimeouts({
                idleTimeout: 10,
                dimTimeout: 500,
                dpmsTimeout: 99999,
                suspendTimeout: 99999,
            })
        ).toEqual({idleTimeout: 60, dimTimeout: 50, dpmsTimeout: 3600, suspendTimeout: 7200});
    });
});

describe('Hypridle write-back', () => {
    it('keeps the suspend tier and writes every cascaded key back when idle rises', () => {
        const {h, writes} = initWith({
            idle: 300,
            dim: 240,
            dpms: 600,
            suspend: 1800,
            suspendEnabled: true,
        });
        expect(Object.keys(writes).length).toBe(0);

        h.idleTimeout = 1790;

        expect(h.dpmsTimeout).toBe(1800);
        expect(h.suspendTimeout).toBe(1810);
        expect(writes.idle).toBe(1790);
        expect(writes.dpms).toBe(1800);
        expect(writes.suspend).toBe(1810);

        const lines = buildHypridleConfigLines({
            dimEnabled: h.dimEnabled,
            dimTimeout: h.dimTimeout,
            idleTimeout: h.idleTimeout,
            dpmsEnabled: h.dpmsEnabled,
            dpmsTimeout: h.dpmsTimeout,
            suspendEnabled: h.suspendEnabled,
            suspendTimeout: h.suspendTimeout,
        });
        expect(lines.includes('  on-timeout = systemctl suspend')).toBe(true);
    });

    it('normalises stored values on init and writes them back', () => {
        const {h, writes} = initWith({
            idle: 100,
            dim: 240,
            dpms: 600,
            suspend: 1800,
            suspendEnabled: false,
        });
        expect(h.dimTimeout).toBe(90);
        expect(writes.dim).toBe(90);
        expect(writes.idle).toBe(undefined);
    });

    it('does not write unchanged stored values on init', () => {
        const {writes} = initWith({
            idle: 400,
            dim: 200,
            dpms: 500,
            suspend: 2000,
            suspendEnabled: true,
        });
        expect(Object.keys(writes).length).toBe(0);
    });
});

await run(import.meta.url);
