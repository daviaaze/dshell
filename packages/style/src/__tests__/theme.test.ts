/**
 * Tests for the theme system — palette → CSS generation.
 *
 * Run via: pnpm test
 */

import {type Palette, Theme} from '../theme';
import {describe, expect, it, run} from './test-runner';

describe('Theme.generateCSS', () => {
    const validPalette: Palette = {
        bg: '#1e1e2e',
        fg: '#cdd6f4',
        primary: '#cba6f7',
        surface: '#313244',
        shadow: '#000000',
    };

    it('generates CSS with all required Adwaita variables', () => {
        const css = Theme.generateCSS(validPalette);
        expect(css.includes('--window-bg-color: #1e1e2e')).toBe(true);
        expect(css.includes('--window-fg-color: #cdd6f4')).toBe(true);
        expect(css.includes('--accent-bg-color: #cba6f7')).toBe(true);
        expect(css.includes('--accent-fg-color: #ffffff')).toBe(true);
        expect(css.includes('--accent-color: #cba6f7')).toBe(true);
        expect(css.includes('--card-bg-color: #313244')).toBe(true);
        expect(css.includes('--shade-color: #000000')).toBe(true);
    });

    it('does NOT emit any --shade-* custom properties', () => {
        const css = Theme.generateCSS(validPalette);
        expect(css.includes('--shade-bg')).toBe(false);
        expect(css.includes('--shade-surface')).toBe(false);
        expect(css.includes('--shade-primary')).toBe(false);
        expect(css.includes('--shade-fg')).toBe(false);
        expect(css.includes('--shade-radius')).toBe(false);
    });

    it('throws on missing bg', () => {
        const bad = {...validPalette, bg: ''};
        expect(() => Theme.generateCSS(bad)).toThrow();
    });

    it('throws on missing fg', () => {
        const bad = {...validPalette, fg: ''};
        expect(() => Theme.generateCSS(bad)).toThrow();
    });

    it('throws on missing primary', () => {
        const bad = {...validPalette, primary: ''};
        expect(() => Theme.generateCSS(bad)).toThrow();
    });

    it('throws on missing surface', () => {
        const bad = {...validPalette, surface: ''};
        expect(() => Theme.generateCSS(bad)).toThrow();
    });

    it('throws on missing shadow', () => {
        const bad = {...validPalette, shadow: ''};
        expect(() => Theme.generateCSS(bad)).toThrow();
    });

    it('throws on undefined value', () => {
        const bad = {...validPalette, bg: undefined as unknown as string};
        expect(() => Theme.generateCSS(bad)).toThrow();
    });

    it('uses --accent-color matching --accent-bg-color', () => {
        const css = Theme.generateCSS(validPalette);
        // Both should use the primary value
        const accentBg = css.match(/--accent-bg-color:\s*(#[0-9a-fA-F]+)/)?.[1];
        const accentColor = css.match(/--accent-color:\s*(#[0-9a-fA-F]+)/)?.[1];
        expect(accentBg).toBe(accentColor);
    });

    it('produces well-formed CSS block', () => {
        const css = Theme.generateCSS(validPalette);
        expect(css.startsWith('* {')).toBe(true);
        expect(css.endsWith('}')).toBe(true);
    });
});

describe('Palette type', () => {
    it('accepts a valid palette object', () => {
        const p: Palette = {
            bg: '#000',
            fg: '#fff',
            primary: '#3584e4',
            surface: '#222',
            shadow: '#000',
        };
        expect(p.bg).toBe('#000');
        expect(p.primary).toBe('#3584e4');
    });
});

run(import.meta.url);
