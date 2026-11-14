import {parseHyprOption} from '@shade/services/compositor/port';
import {normalizeHyprOptionKey} from '../settings/mouse';
import {describe, expect, it, run} from './test-runner';

describe('parseHyprOption', () => {
    it('parses true and false bool output', () => {
        expect(parseHyprOption('bool: true', 'fallback')).toBe('true');
        expect(parseHyprOption('bool: false', 'fallback')).toBe('false');
    });

    it('parses strings and preserves their spaces', () => {
        expect(parseHyprOption('str: flat', 'fallback')).toBe('flat');
        expect(parseHyprOption('string: custom profile ', 'fallback')).toBe('custom profile ');
    });

    it('parses legacy integer and float output without changing values', () => {
        expect(parseHyprOption('int: 1', 'fallback')).toBe('1');
        expect(parseHyprOption('float: -0.25', 'fallback')).toBe('-0.25');
    });

    it('returns fallback for missing or unrecognized output', () => {
        expect(parseHyprOption('', 'fallback')).toBe('fallback');
        expect(parseHyprOption('unknown: value', 'fallback')).toBe('fallback');
    });
});

describe('normalizeHyprOptionKey', () => {
    it('converts separators and hyphens to Lua config syntax', () => {
        expect(normalizeHyprOptionKey('input:touchpad:tap-to-click')).toBe(
            'input.touchpad.tap_to_click'
        );
        expect(normalizeHyprOptionKey('input:touchpad:tap-and-drag')).toBe(
            'input.touchpad.tap_and_drag'
        );
    });
});

run(import.meta.url);
