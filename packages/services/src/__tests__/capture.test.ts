/**
 * Smoke tests for capture services — verify module loads and singleton.
 */
import Screenshot from '../capture/screenshot';
import {describe, it, expect, run} from './test-runner';

describe('Screenshot', () => {
    it('get_default returns same instance', () => {
        const a = Screenshot.get_default();
        const b = Screenshot.get_default();
        expect(a).toBe(b);
    });

    it('has expected initial state', () => {
        const s = Screenshot.get_default();
        expect(s.recording).toBe(false);
    });
});

await run(import.meta.url);
