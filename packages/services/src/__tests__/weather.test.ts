/**
 * Tests for the location domain's pure helpers (weatherUtils.ts).
 *
 * The Weather GObject itself is intentionally NOT instantiated here: its
 * constructor calls GWeather.Info.set_application_id(import.meta.domain),
 * which is undefined outside a running GApplication — the same reason no
 * existing test constructs it directly. The pure format/astro helpers are
 * the honest unit-testable surface of this domain.
 */
import {formatTemp, isDaytime, sunAngle, windDirectionLabel} from '../location/weatherUtils';
import {describe, expect, it, run} from './test-runner';

describe('weatherUtils', () => {
    it('formatTemp appends the degree symbol and rounds', () => {
        expect(formatTemp(24.4)).toBe('24°');
        expect(formatTemp(24.6)).toBe('25°');
    });

    it('windDirectionLabel maps the GWeather enum to compass abbreviations', () => {
        expect(windDirectionLabel(-1)).toBe('—'); // INVALID
        expect(windDirectionLabel(0)).toBe('—'); // VARIABLE
        expect(windDirectionLabel(1)).toBe('N');
        expect(windDirectionLabel(5)).toBe('E');
        expect(windDirectionLabel(16)).toBe('NNW');
        expect(windDirectionLabel(99)).toBe('—'); // out of range
    });

    it('sunAngle returns -1 outside daylight hours', () => {
        // sunrise=3600, sunset=7200 (1h window)
        expect(sunAngle(3600, 7200, 3500)).toBe(-1); // before sunrise
        expect(sunAngle(3600, 7200, 7300)).toBe(-1); // after sunset
        expect(sunAngle(-1, 7200, 5000)).toBe(-1); // invalid sunrise
        expect(sunAngle(3600, 3600, 5000)).toBe(-1); // zero day length
    });

    it('sunAngle peaks at noon and is 0 at the edges', () => {
        // sunrise=100, sunset=10000 → noon=5050 (sunrise must be > 0)
        expect(sunAngle(100, 10000, 5050)).toBeGreaterThan(0.99); // ~1 at noon
        expect(sunAngle(100, 10000, 100)).toBeLessThan(0.001); // ~0 at sunrise
        expect(sunAngle(100, 10000, 10000)).toBeLessThan(0.001); // ~0 at sunset
    });

    it('isDaytime is true between sunrise and sunset, inclusive', () => {
        expect(isDaytime(3600, 7200, 3600)).toBe(true); // at sunrise
        expect(isDaytime(3600, 7200, 5400)).toBe(true); // midday
        expect(isDaytime(3600, 7200, 7200)).toBe(true); // at sunset
        expect(isDaytime(3600, 7200, 3599)).toBe(false); // just before
        expect(isDaytime(3600, 7200, 7201)).toBe(false); // just after
    });
});

await run(import.meta.url);
