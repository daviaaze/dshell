/**
 * Tests for the domain-owned OSD state:
 *   - OsdTimer debounce helper (trigger, visible flag, dispose)
 *   - AudioController / Brightness / Touchpad expose their OSD props
 *     and default to hidden
 */
import OsdTimer from '../utils/osdTimer';
import AudioController from '../audio/audioController';
import Brightness from '../display/brightness';
import Touchpad from '../input/touchpad';
import {describe, it, expect, run} from './test-runner';

describe('OsdTimer', () => {
    it('starts hidden', () => {
        const t = new OsdTimer(() => {});
        expect(t.visible).toBe(false);
    });

    it('trigger reveals and notifies', () => {
        const changes: boolean[] = [];
        const t = new OsdTimer(v => changes.push(v));
        t.trigger();
        expect(t.visible).toBe(true);
        expect(changes).toEqual([true]);
        t.dispose();
    });

    it('retrigger while visible does not re-notify', () => {
        const changes: boolean[] = [];
        const t = new OsdTimer(v => changes.push(v));
        t.trigger();
        t.trigger();
        expect(t.visible).toBe(true);
        expect(changes).toEqual([true]);
        t.dispose();
    });

    it('dispose hides and notifies', () => {
        const changes: boolean[] = [];
        const t = new OsdTimer(v => changes.push(v));
        t.trigger();
        t.dispose();
        expect(t.visible).toBe(false);
        expect(changes).toEqual([true, false]);
    });
});

describe('AudioController OSD', () => {
    it('exposes speaker/mic OSD props, hidden by default', () => {
        const a = AudioController.get_default();
        expect(a.speakerOsdVisible).toBe(false);
        expect(a.micOsdVisible).toBe(false);
    });
});

describe('Brightness OSD', () => {
    it('exposes screen/kbd OSD props, hidden by default', () => {
        const b = Brightness.get_default();
        expect(b.screenOsdVisible).toBe(false);
        expect(b.kbdOsdVisible).toBe(false);
    });
});

describe('Touchpad OSD', () => {
    it('exposes OSD prop, hidden by default', () => {
        const t = Touchpad.get_default();
        expect(t.osdVisible).toBe(false);
    });
});

await run(import.meta.url);
