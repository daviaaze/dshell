/**
 * Tests for logger level and debug-category filtering.
 */

import {
    disableDebugCategories,
    enableDebugCategories,
    LogLevel,
    setLogLevel,
    shouldLog,
} from '../logger';
import {describe, expect, it, run} from './test-runner';

describe('logger category filter', () => {
    it('narrows debug output to the listed categories', () => {
        setLogLevel(LogLevel.DEBUG);
        enableDebugCategories(['weather']);
        try {
            expect(shouldLog(LogLevel.DEBUG, 'weather')).toBe(true);
            expect(shouldLog(LogLevel.DEBUG, 'geo')).toBe(false);
        } finally {
            disableDebugCategories();
            setLogLevel(LogLevel.INFO);
        }
    });

    it('never hides warnings and errors from unlisted categories', () => {
        enableDebugCategories(['weather']);
        try {
            expect(shouldLog(LogLevel.WARN, 'geo')).toBe(true);
            expect(shouldLog(LogLevel.ERROR, 'geo')).toBe(true);
            expect(shouldLog(LogLevel.INFO, 'geo')).toBe(true);
        } finally {
            disableDebugCategories();
        }
    });

    it('still honours the global level', () => {
        expect(shouldLog(LogLevel.DEBUG, 'weather')).toBe(false);
    });
});

await run(import.meta.url);
