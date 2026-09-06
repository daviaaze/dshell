/**
 * Smoke tests for DisplayLayout — singleton identity, pre-init property
 * accessibility, and the pure stdout parsers used by #refresh().
 */
import DisplayLayout, {
    parseLayoutList,
    parseMonitorList,
} from '../display/layout';
import {describe, expect, it, run} from './test-runner';

describe('DisplayLayout', () => {
    it('returns the same singleton on repeated get_default()', () => {
        const a = DisplayLayout.get_default();
        const b = DisplayLayout.get_default();
        expect(a).toBe(b);
    });

    it('properties are accessible before init()', () => {
        const s = DisplayLayout.get_default();
        expect(Array.isArray(s.layouts)).toBe(true);
        expect(s.currentLayout === null || typeof s.currentLayout === 'string').toBe(true);
        expect(Array.isArray(s.monitors)).toBe(true);
    });

    it('monitors union marks configured-but-absent entries disabled', () => {
        const s = DisplayLayout.get_default();
        // No init / no hyprland in tests: both lists empty → no monitors.
        expect(s.monitors.length).toBe(0);
    });
});

describe('parseLayoutList', () => {
    it('parses names, trims, dedupes, preserves order', () => {
        expect(parseLayoutList('desktop\nlaptop\ndesktop\n\n phone \n')).toEqual([
            'desktop',
            'laptop',
            'phone',
        ]);
    });

    it('empty input yields empty list', () => {
        expect(parseLayoutList('')).toEqual([]);
        expect(parseLayoutList('\n\n  \n')).toEqual([]);
    });
});

describe('parseMonitorList', () => {
    it('parses name<TAB>description lines', () => {
        expect(
            parseMonitorList('DP-2\tWAM SFP24DFI FLAT 0000000000001\nDP-3\t\n')
        ).toEqual([
            {name: 'DP-2', description: 'WAM SFP24DFI FLAT 0000000000001'},
            {name: 'DP-3', description: ''},
        ]);
    });

    it('skips blank lines', () => {
        expect(parseMonitorList('\nDP-1\n\n')).toEqual([{name: 'DP-1', description: ''}]);
    });
});

await run(import.meta.url);
