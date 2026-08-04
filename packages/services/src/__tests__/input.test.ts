/**
 * Smoke tests for input services — verify module loads and singletons.
 */

import KeyboardLayout from '../input/keyboard';
import Touchpad from '../input/touchpad';
import {describe, expect, it, run} from './test-runner';

describe('Touchpad', () => {
    it('get_default returns same instance', () => {
        const a = Touchpad.get_default();
        const b = Touchpad.get_default();
        expect(a).toBe(b);
    });
});

describe('KeyboardLayout', () => {
    it('get_default returns same instance', () => {
        const a = KeyboardLayout.get_default();
        const b = KeyboardLayout.get_default();
        expect(a).toBe(b);
    });
});

await run(import.meta.url);
