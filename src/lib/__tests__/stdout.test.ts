/**
 * Tests for printOut — explicit stdout writer.
 *
 * Run: gjs -m src/lib/__tests__/stdout.test.ts
 */

import printOut from '../core/stdout';
import {describe, it, expect, run} from './test-runner';

describe('printOut', () => {
    it('does not throw', () => {
        let threw = false;
        try {
            printOut('hello');
        } catch {
            threw = true;
        }
        expect(threw).toBe(false);
    });

    it('does not throw with empty string', () => {
        let threw = false;
        try {
            printOut('');
        } catch {
            threw = true;
        }
        expect(threw).toBe(false);
    });

    it('does not throw with multiline text', () => {
        let threw = false;
        try {
            printOut('line1\nline2\nline3');
        } catch {
            threw = true;
        }
        expect(threw).toBe(false);
    });
});

await run(import.meta.url);
