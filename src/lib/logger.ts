import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio';

// ── Log Levels ───────────────────────────────────────────────────────────────
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
};

const LEVEL_METHODS = {
    [LogLevel.DEBUG]: print,
    [LogLevel.INFO]: print,
    [LogLevel.WARN]: console.warn,
    [LogLevel.ERROR]: console.error,
} as const;

// ── Configuration ────────────────────────────────────────────────────────────
const PREFIX = '[Shade]';
let globalLevel: LogLevel = LogLevel.INFO;
const debugCategories = new Set<string>();

// GSettings schema path for debug settings
const DEBUG_SCHEMA_ID = import.meta.domain
    ? `${import.meta.domain}.general`
    : 'org.shade-shell.general';

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(): string {
    return GLib.DateTime.new_now_local().format('%H:%M:%S.%f') || '?';
}

function shouldLog(level: LogLevel, category?: string): boolean {
    if (level < globalLevel) return false;
    if (category && debugCategories.size > 0 && !debugCategories.has(category))
        return false;
    return true;
}

function formatArgs(args: unknown[]): unknown[] {
    return args.map(a => {
        if (a instanceof Error)
            return `${a.message}\n${a.stack || '(no stack)'}`;
        if (typeof a === 'object' && a !== null) {
            try {
                const json = JSON.stringify(a);
                // Truncate long strings to avoid flooding output
                return json.length > 500
                    ? `${json.slice(0, 500)}… (truncated ${json.length}B)`
                    : json;
            } catch {
                return `[${typeof a}]`;
            }
        }
        return a;
    });
}

// ── Global Level Control ─────────────────────────────────────────────────────
export function setLogLevel(level: LogLevel): void {
    globalLevel = level;
    print(`${PREFIX} log level set to ${LEVEL_LABELS[level]}`);
}

export function enableDebugCategories(categories: string[]): void {
    for (const c of categories) debugCategories.add(c);
}

export function disableDebugCategories(): void {
    debugCategories.clear();
}

// Try to load debug settings from GSettings
export function initLoggerFromSettings(): void {
    try {
        const settings = new Gio.Settings({schemaId: DEBUG_SCHEMA_ID});

        // Check for debug-enabled key
        if ('debug-enabled' in settings) {
            const debugEnabled = settings.get_boolean('debug-enabled');
            if (debugEnabled) setLogLevel(LogLevel.DEBUG);
        }

        // Check for debug-categories key
        if ('debug-categories' in settings) {
            const cats = settings.get_strv('debug-categories');
            if (cats.length > 0) enableDebugCategories(cats);
        }

        // Listen for runtime changes
        settings.connect('changed::debug-enabled', () => {
            const enabled = settings.get_boolean('debug-enabled');
            setLogLevel(enabled ? LogLevel.DEBUG : LogLevel.INFO);
        });
        settings.connect('changed::debug-categories', () => {
            disableDebugCategories();
            const cats = settings.get_strv('debug-categories');
            if (cats.length > 0) enableDebugCategories(cats);
        });
    } catch {
        // GSettings may not be available in all contexts
        print(`${PREFIX} logger: GSettings not available for debug config`);
    }
}

// ── Core Logger ──────────────────────────────────────────────────────────────
function logAt(level: LogLevel, category: string, ...args: unknown[]): void {
    if (!shouldLog(level, category)) return;
    const label = LEVEL_LABELS[level];
    const fn = LEVEL_METHODS[level];
    fn(
        `${PREFIX} [${label}] [${category}] ${formatTime()} -`,
        ...formatArgs(args)
    );
}

export const logger = {
    debug: (cat: string, ...args: unknown[]) =>
        logAt(LogLevel.DEBUG, cat, ...args),
    info: (cat: string, ...args: unknown[]) =>
        logAt(LogLevel.INFO, cat, ...args),
    warn: (cat: string, ...args: unknown[]) =>
        logAt(LogLevel.WARN, cat, ...args),
    error: (cat: string, ...args: unknown[]) =>
        logAt(LogLevel.ERROR, cat, ...args),

    // Convenience: backward-compatible with old logger API (no category = "general")
    log: (...args: unknown[]) => logAt(LogLevel.INFO, 'general', ...args),
};

// ── Performance Timer ────────────────────────────────────────────────────────
interface TimerEntry {
    start: number;
    label: string;
    category: string;
}

const activeTimers = new Map<string, TimerEntry>();

export const perf = {
    /** Start a named timer. Returns the timer id. */
    start(label: string, category: string = 'perf'): string {
        const id = `${category}.${label}`;
        activeTimers.set(id, {
            start: GLib.get_monotonic_time(),
            label,
            category,
        });
        logger.debug(category, `⏱ START ${label}`);
        return id;
    },

    /** Stop a named timer and log the elapsed time in milliseconds. */
    stop(label: string, category: string = 'perf'): number {
        const id = `${category}.${label}`;
        const entry = activeTimers.get(id);
        if (!entry) {
            logger.warn('perf', `Timer "${id}" was never started`);
            return 0;
        }
        const elapsed = (GLib.get_monotonic_time() - entry.start) / 1000; // ms
        activeTimers.delete(id);
        logger.info(category, `⏱ ${label} = ${elapsed.toFixed(2)}ms`);
        return elapsed;
    },

    /** Time an async operation. Returns the result of the operation. */
    async measure<T>(
        label: string,
        fn: () => Promise<T>,
        category: string = 'perf'
    ): Promise<T> {
        perf.start(label, category);
        try {
            return await fn();
        } finally {
            perf.stop(label, category);
        }
    },

    /** Time a sync operation. Returns the result of the operation. */
    measureSync<T>(label: string, fn: () => T, category: string = 'perf'): T {
        perf.start(label, category);
        try {
            return fn();
        } finally {
            perf.stop(label, category);
        }
    },
};

// ── Error Boundary Helpers ───────────────────────────────────────────────────
/**
 * Wrap a function with try/catch that logs errors with the given category.
 * Use for widget mount, signal handlers, and async operations.
 */
export function safeTry<T>(
    category: string,
    label: string,
    fn: () => T
): T | undefined {
    try {
        return fn();
    } catch (e) {
        logger.error(category, `${label} failed:`, e);
        return undefined;
    }
}

export default logger;
