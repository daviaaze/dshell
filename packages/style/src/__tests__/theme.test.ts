/**
 * Tests for palette validation and semantic accent contrast.
 *
 */

import {
    ACCENT_TEXT_CONTRAST_MIN,
    type Palette,
    Theme,
    contrastRatio,
    resolveAccentRoles,
} from '../theme';
import {describe, expect, it, run} from './test-runner';

const validPalette: Palette = {
    bg: '#1e1e2e',
    fg: '#cdd6f4',
    primary: '#3584e4',
    surface: '#313244',
    shadow: '#000000',
};

function expectAtLeast(actual: number, minimum: number): void {
    expect(actual >= minimum).toBe(true);
}

describe('Theme.generateCSS palette validation', () => {
    it('rejects invalid values in every palette color field', () => {
        for (const key of ['bg', 'fg', 'primary', 'surface', 'shadow'] as const) {
            expect(() => Theme.generateCSS({...validPalette, [key]: 'not-a-color'})).toThrow();
            expect(() => Theme.generateCSS({...validPalette, [key]: ''})).toThrow();
            expect(() =>
                Theme.generateCSS({...validPalette, [key]: undefined as unknown as string})
            ).toThrow();
        }
    });

    it('rejects a translucent window background', () => {
        expect(() => Theme.generateCSS({...validPalette, bg: '#ffffff80'})).toThrow();
    });
});

describe('semantic accent contrast', () => {
    it('computes luminance contrast extrema and fully transparent foreground', () => {
        expect(contrastRatio('#ffffff', '#000000')).toBe(21);
        expect(contrastRatio('rgba(255,255,255,0)', '#121212')).toBe(1);
    });

    it('selects the higher-contrast foreground against accent backgrounds', () => {
        const light = resolveAccentRoles('#ffff00', '#ffffff');
        expect(light.foreground).toBe('#000000');
        expect(contrastRatio(light.foreground, light.background)).toBeGreaterThan(
            contrastRatio('#ffffff', light.background)
        );

        const dark = resolveAccentRoles('#222222', '#1a1a1a');
        expect(dark.foreground).toBe('#ffffff');
        expect(contrastRatio(dark.foreground, dark.background)).toBeGreaterThan(
            contrastRatio('#000000', dark.background)
        );
    });

    it('resolves default blue and bright, dark, and gray dynamic primaries', () => {
        for (const [primary, background] of [
            ['#3584e4', '#ffffff'],
            ['#ffff00', '#ffffff'],
            ['#101010', '#ffffff'],
            ['#777777', '#ffffff'],
            ['#777777', '#1a1a1a'],
            ['#1956c8', '#1a1a1a'],
            ['#ffff00', '#1a1a1a'],
        ]) {
            const roles = resolveAccentRoles(primary, background);
            expectAtLeast(
                contrastRatio(roles.foreground, roles.background),
                ACCENT_TEXT_CONTRAST_MIN
            );
            expectAtLeast(
                contrastRatio(roles.standalone, background),
                ACCENT_TEXT_CONTRAST_MIN
            );
        }

        const defaultBlue = resolveAccentRoles('#3584e4', '#ffffff');
        expect(defaultBlue.background).toBe('#3584e4');
        expectAtLeast(
            contrastRatio(defaultBlue.standalone, '#ffffff'),
            ACCENT_TEXT_CONTRAST_MIN
        );
    });

    it('composites a translucent primary onto the known opaque background', () => {
        const roles = resolveAccentRoles('#ff000080', '#ffffff');
        expect(contrastRatio(roles.background, '#ff8080')).toBeLessThan(1.01);
        expectAtLeast(
            contrastRatio(roles.foreground, roles.background),
            ACCENT_TEXT_CONTRAST_MIN
        );
        expectAtLeast(
            contrastRatio(roles.standalone, '#ffffff'),
            ACCENT_TEXT_CONTRAST_MIN
        );
    });

    it('keeps standalone contrast above threshold after 8-bit rounding', () => {
        const primary = '#777777';
        const roles = resolveAccentRoles(primary, '#ffffff');

        expect(contrastRatio(primary, '#ffffff')).toBeLessThan(ACCENT_TEXT_CONTRAST_MIN);
        expect(roles.standalone === primary).toBe(false);
        expectAtLeast(
            contrastRatio(roles.standalone, '#ffffff'),
            ACCENT_TEXT_CONTRAST_MIN
        );
    });

    it('rejects invalid colors and translucent window backgrounds', () => {
        expect(() => contrastRatio('not-a-color', '#ffffff')).toThrow();
        expect(() => contrastRatio('#000000', 'not-a-color')).toThrow();
        expect(() => contrastRatio('#000000', '#ffffff80')).toThrow();
        expect(() => resolveAccentRoles('#3584e4', '#ffffff80')).toThrow();
    });
});

run(import.meta.url);
