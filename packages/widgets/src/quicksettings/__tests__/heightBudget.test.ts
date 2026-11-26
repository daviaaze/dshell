import {describe, expect, it, run} from '../../__tests__/test-runner';
import {quickSettingsContentHeight} from '../heightBudget';

const home = {
    monitorHeight: 800,
    reservedTop: 0,
    reservedBottom: 0,
    headerHeight: 47,
    errorHeight: 0,
    footerHeight: 34 + 12,
    surfaceInsets: 0,
};

describe('Quick Settings height budget', () => {
    it('keeps the measured Home footer inside the 792px layer at 1280×800', () => {
        const viewport = quickSettingsContentHeight(home);
        expect(viewport).toBe(699);
        expect(home.headerHeight + viewport + home.footerHeight).toBe(792);
        expect(home.headerHeight + viewport + 34).toBe(780);
    });

    it('scrolls only the genuine 27px content excess from the measured 800px case', () => {
        // The original stack was 748px plus its 24px margins. Remove its 34px
        // action row and preceding 12px section gap; page margins remain inside.
        const contentHeight = 748 + 24 - 34 - 12;
        expect(contentHeight).toBe(726);
        expect(Math.max(0, contentHeight - quickSettingsContentHeight(home))).toBe(27);
        expect(
            Math.max(
                0,
                contentHeight - quickSettingsContentHeight({...home, monitorHeight: 900})
            )
        ).toBe(0);
    });

    it('does not reserve a footer on routes without footer actions', () => {
        expect(quickSettingsContentHeight({...home, footerHeight: 0})).toBe(745);
    });

    it('subtracts logical top and bottom reservations once', () => {
        expect(quickSettingsContentHeight({...home, reservedTop: 52, reservedBottom: 20})).toBe(
            627
        );
    });

    it('counts measured error, Displays footer margins and root insets once', () => {
        expect(
            quickSettingsContentHeight({
                ...home,
                errorHeight: 32,
                footerHeight: 34 + 8 + 12,
                surfaceInsets: 2,
            })
        ).toBe(657);
    });

    it('rounds down fractional logical height and retains a positive viewport', () => {
        expect(quickSettingsContentHeight({...home, monitorHeight: 800.75})).toBe(699);
        expect(quickSettingsContentHeight({...home, monitorHeight: 100})).toBe(1);
    });
});

await run(import.meta.url);
