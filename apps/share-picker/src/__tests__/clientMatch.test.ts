import {describe, expect, it, run} from '../../../../packages/services/src/__tests__/test-runner';
import {getWindowCaptureId, matchXDPHToHyprctl} from '../clientMatch';
import type {HyprClient, XDPHWindow} from '../types';

function client(address: string, clazz: string, title: string, mapped = true): HyprClient {
    return {
        address,
        stableId: 'abc12',
        class: clazz,
        title,
        at: [0, 0],
        size: [100, 100],
        mapped,
        hidden: false,
    };
}

function xdph(clazz: string, title: string, address = ''): XDPHWindow {
    return {id: '1', clazz, title, address};
}

describe('matchXDPHToHyprctl', () => {
    it('prefers the address when XDPH supplies one', () => {
        const clients = [client('0xa', 'kitty', 'one'), client('0xb', 'kitty', 'two')];
        expect(matchXDPHToHyprctl(xdph('kitty', 'one', '0xb'), clients)?.address).toBe('0xb');
    });

    it('matches class and exact title when there is no address', () => {
        const clients = [client('0xa', 'kitty', 'one'), client('0xb', 'kitty', 'two')];
        expect(matchXDPHToHyprctl(xdph('Kitty', 'two'), clients)?.address).toBe('0xb');
    });

    it('does not attach another window of the same class when the title differs', () => {
        const clients = [client('0xa', 'kitty', 'unrelated')];
        expect(matchXDPHToHyprctl(xdph('kitty', 'one'), clients)).toBe(null);
    });

    it('does not fall back to the first candidate among several same-class windows', () => {
        const clients = [client('0xa', 'kitty', 'one'), client('0xb', 'kitty', 'two')];
        expect(matchXDPHToHyprctl(xdph('kitty', 'three'), clients)).toBe(null);
    });

    it('never matches an empty XDPH title by prefix', () => {
        const clients = [client('0xa', 'kitty', 'one')];
        expect(matchXDPHToHyprctl(xdph('kitty', ''), clients)).toBe(null);
    });

    it('does not attach a window whose title merely shares a prefix', () => {
        const clients = [client('0xa', 'zen', 'Backspace - Zen Browser')];
        expect(matchXDPHToHyprctl(xdph('zen', 'Backspace'), clients)).toBe(null);
    });

    it('rejects ambiguous title matches rather than picking the first window', () => {
        const clients = [client('0xa', 'kitty', 'one'), client('0xb', 'kitty', 'one')];
        expect(matchXDPHToHyprctl(xdph('kitty', 'one'), clients)).toBe(null);
    });

    it('does not treat differently capitalized titles as the same window', () => {
        expect(matchXDPHToHyprctl(xdph('kitty', 'One'), [client('0xa', 'kitty', 'one')])).toBe(
            null
        );
    });

    it('does not preview a hidden client even when its address matches', () => {
        const clients = [{...client('0xa', 'kitty', 'one'), hidden: true}];
        expect(matchXDPHToHyprctl(xdph('kitty', 'one', '0xa'), clients)).toBe(null);
    });

    it('ignores unmapped clients', () => {
        const clients = [client('0xa', 'kitty', 'one', false)];
        expect(matchXDPHToHyprctl(xdph('kitty', 'one'), clients)).toBe(null);
    });
});

describe('getWindowCaptureId', () => {
    it('uses the exact portal address and preserves the opaque stable ID', () => {
        const clients = [
            {...client('0xa', 'kitty', 'one'), stableId: '123'},
            {...client('0xb', 'other-app', 'renamed'), stableId: 'aBc9'},
        ];
        expect(getWindowCaptureId(xdph('kitty', 'one', '0xb'), clients)).toBe('aBc9');
    });

    it('does not turn a metadata title/class match into a pixel capture', () => {
        const window = xdph('Kitty', 'one');
        const clients = [client('0xa', 'kitty', 'one')];
        expect(matchXDPHToHyprctl(window, clients)?.address).toBe('0xa');
        expect(getWindowCaptureId(window, clients)).toBe(null);
    });

    it('does not substitute another window when the portal address has disappeared', () => {
        const window = xdph('kitty', 'one', '0xclosed');
        const clients = [client('0xa', 'kitty', 'one')];
        expect(getWindowCaptureId(window, clients)).toBe(null);
    });

    it('rejects hidden and unmapped clients even at the exact address', () => {
        const window = xdph('kitty', 'one', '0xa');
        expect(getWindowCaptureId(window, [{...client('0xa', 'kitty', 'one'), hidden: true}])).toBe(
            null
        );
        expect(getWindowCaptureId(window, [client('0xa', 'kitty', 'one', false)])).toBe(null);
    });

    it('does not derive a capture ID from an address when stableId is missing', () => {
        const clients = [{...client('0xa', 'kitty', 'one'), stableId: null}];
        expect(getWindowCaptureId(xdph('kitty', 'one', '0xa'), clients)).toBe(null);
    });

    it('accepts the opaque zero ID but never coerces a numeric value', () => {
        const window = xdph('kitty', 'one', '0xa');
        expect(
            getWindowCaptureId(window, [{...client('0xa', 'kitty', 'one'), stableId: '0'}])
        ).toBe('0');
        expect(
            getWindowCaptureId(window, [
                {...client('0xa', 'kitty', 'one'), stableId: 0} as unknown as HyprClient,
            ])
        ).toBe(null);
    });

    it('rejects empty, oversized, and non-printable protocol IDs', () => {
        const window = xdph('kitty', 'one', '0xa');
        for (const stableId of ['', 'a'.repeat(33), 'abc\n', 'á', '\u0000']) {
            expect(
                getWindowCaptureId(window, [{...client('0xa', 'kitty', 'one'), stableId}])
            ).toBe(null);
        }
    });
});

await run(import.meta.url);
