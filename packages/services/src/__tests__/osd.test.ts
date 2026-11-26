/**
 * Tests for the domain-owned OSD state:
 *   - OsdTimer debounce helper (trigger, visible flag, dispose)
 *   - AudioController / Brightness / Touchpad expose their OSD props
 *     and default to hidden
 */

import AudioController from '../audio/audioController';
import Brightness from '../display/brightness';
import Touchpad from '../input/touchpad';
import OsdTimer from '../utils/osdTimer';
import {describe, expect, it, run} from './test-runner';

function sleep(ms: number): Promise<void> {
    const {promise, resolve} = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
}

describe('OsdTimer', () => {
    it('starts hidden', () => {
        const t = new OsdTimer(() => {});
        expect(t.visible).toBe(false);
    });

    it('trigger reveals and notifies', () => {
        const changes: boolean[] = [];
        const t = new OsdTimer((v) => changes.push(v));
        t.trigger();
        expect(t.visible).toBe(true);
        expect(changes).toEqual([true]);
        t.dispose();
    });

    it('retrigger while visible does not re-notify', () => {
        const changes: boolean[] = [];
        const t = new OsdTimer((v) => changes.push(v));
        t.trigger();
        t.trigger();
        expect(t.visible).toBe(true);
        expect(changes).toEqual([true]);
        t.dispose();
    });

    it('dispose hides and notifies', () => {
        const changes: boolean[] = [];
        const t = new OsdTimer((v) => changes.push(v));
        t.trigger();
        t.dispose();
        expect(t.visible).toBe(false);
        expect(changes).toEqual([true, false]);
    });

    it.async('auto-hides after timeoutMs and notifies', async () => {
        const changes: boolean[] = [];
        const t = new OsdTimer((v) => changes.push(v), 20);
        t.trigger();
        await sleep(80);
        expect(t.visible).toBe(false);
        expect(changes).toEqual([true, false]);
    });

    it.async('retrigger restarts the full timeout', async () => {
        const t = new OsdTimer(() => {}, 100);
        t.trigger();
        await sleep(60);
        t.trigger();
        await sleep(60); // past the first deadline, inside the second
        expect(t.visible).toBe(true);
        await sleep(100);
        expect(t.visible).toBe(false);
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
