/**
 * Smoke tests for audio services — verify modules load and singletons work.
 */
import AudioController from '../audio/audioController';
import SoundAlerts from '../audio/soundAlerts';
import {describe, it, expect, run} from './test-runner';

describe('AudioController', () => {
    it('get_default returns same instance', () => {
        const a = AudioController.get_default();
        const b = AudioController.get_default();
        expect(a).toBe(b);
    });
});

describe('SoundAlerts', () => {
    it('get_default returns same instance', () => {
        const a = SoundAlerts.get_default();
        const b = SoundAlerts.get_default();
        expect(a).toBe(b);
    });
});

await run(import.meta.url);
