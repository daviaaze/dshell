import {describe, expect, it, run} from '../../__tests__/test-runner';
import {
    appendVisibleKey,
    expireVisibleKeys,
    KeySequenceTracker,
    parseKeyInputEvent,
    type VisibleKey,
} from '../keystrokeOverlayModel';

describe('Hyprland keystroke overlay model', () => {
    it('accepts press and release events but rejects repeats and malformed payloads', () => {
        expect(parseKeyInputEvent('custom', 'shade-key:38,1')).toEqual({keycode: 38, state: 1});
        expect(parseKeyInputEvent('custom', 'shade-key:38,0')).toEqual({keycode: 38, state: 0});
        expect(parseKeyInputEvent('custom', 'shade-key:38,2')).toBeNull();
        expect(parseKeyInputEvent('activewindow', 'shade-key:38,1')).toBeNull();
        expect(parseKeyInputEvent('custom', 'shade-key:999,1')).toBeNull();
        expect(parseKeyInputEvent('custom', 'shade-key:38,1;malicious')).toBeNull();
    });

    it('keeps only the newest four unexpired display labels', () => {
        const keys: VisibleKey[] = [
            {label: 'A', expiresAt: 900},
            {label: 'B', expiresAt: 2_000},
            {label: 'C', expiresAt: 2_000},
            {label: 'D', expiresAt: 2_000},
            {label: 'E', expiresAt: 2_000},
        ];
        const next = appendVisibleKey(keys, 'F', 1_000, 1_200, 4);
        expect(next.map((entry) => entry.label)).toEqual(['C', 'D', 'E', 'F']);
        expect(expireVisibleKeys(next, 2_200)).toEqual([]);
    });
    it('formats modifier chords from press and release transitions', () => {
        const tracker = new KeySequenceTracker();
        expect(tracker.handle({keycode: 50, state: 1}, 'Shift')).toBe('Shift');
        expect(tracker.handle({keycode: 38, state: 1}, 'A')).toBe('Shift+A');
        expect(tracker.handle({keycode: 50, state: 0}, 'Shift')).toBeNull();
        expect(tracker.handle({keycode: 56, state: 1}, 'B')).toBe('B');
        tracker.clear();
        expect(tracker.handle({keycode: 56, state: 0}, 'B')).toBeNull();
    });
});

run(import.meta.url);
