import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {type CreateSettings, createSettings} from 'gnim/schema';
import {bus} from '../bus';
import DndService from '../notifications/dnd';
import {describe, expect, it, run} from './test-runner';

const scheduleKeys = {
    'dnd-schedule-enabled': 'b',
    'dnd-schedule-start-hour': 'i',
    'dnd-schedule-end-hour': 'i',
} as const;

if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory') {
    throw new Error('DND schedule tests require GSETTINGS_BACKEND=memory (use scripts/test.sh)');
}

interface FixtureOptions {
    hour?: number;
    dnd?: boolean;
    enabled?: boolean;
    start?: number;
    end?: number;
    daemonAvailable?: boolean;
}

interface Fixture {
    service: DndService;
    settings: CreateSettings<typeof scheduleKeys>;
    raw: Gio.Settings;
    writes: boolean[];
    activeTimers: number;
    timerStarts: number;
    tick(hour?: number): void;
    restart(): Gio.Settings;
    dispose(): void;
}

function fixture(options: FixtureOptions = {}): Fixture {
    const raw = new Gio.Settings({schemaId: `${import.meta.domain}.general`});
    for (const key of Object.keys(scheduleKeys)) raw.reset(key);
    const settings = createSettings(raw, scheduleKeys);
    settings.setDndScheduleEnabled(options.enabled ?? false);
    settings.setDndScheduleStartHour(options.start ?? 22);
    settings.setDndScheduleEndHour(options.end ?? 7);

    let hour = options.hour ?? 12;
    let nativeDnd = options.dnd ?? false;
    const writes: boolean[] = [];
    const daemon = {
        get dontDisturb() { return nativeDnd; },
        set dontDisturb(value: boolean) {
            nativeDnd = value;
            writes.push(value);
        },
    };
    const timers = new Set<() => void>();
    let timerStarts = 0;
    const dependencies = {
        getNotifd: () => options.daemonAvailable === false ? null : daemon,
        currentHour: () => hour,
        startTimer(callback: () => void) {
            timerStarts++;
            timers.add(callback);
            return () => { timers.delete(callback); };
        },
    };
    let service = new DndService(dependencies);
    service.init(settings);

    return {
        get service() { return service; },
        settings,
        raw,
        writes,
        get activeTimers() { return timers.size; },
        get timerStarts() { return timerStarts; },
        tick(nextHour = hour) {
            hour = nextHour;
            for (const callback of timers) callback();
        },
        restart() {
            service.dispose();
            const reopened = new Gio.Settings({schemaId: `${import.meta.domain}.general`});
            service = new DndService(dependencies);
            service.init(createSettings(reopened, scheduleKeys));
            return reopened;
        },
        dispose() {
            service.dispose();
            for (const key of Object.keys(scheduleKeys)) raw.reset(key);
        },
    };
}

function withFixture(options: FixtureOptions, test: (f: Fixture) => void) {
    const f = fixture(options);
    try {
        test(f);
    } finally {
        f.dispose();
    }
}

describe('persistent Do Not Disturb schedule', () => {
    it('defaults to disabled at 22:00–07:00 without changing native DND', () => {
        withFixture({dnd: true}, (f) => {
            for (const key of Object.keys(scheduleKeys)) f.raw.reset(key);
            expect(f.settings.dndScheduleEnabled()).toBe(false);
            expect(f.settings.dndScheduleStartHour()).toBe(22);
            expect(f.settings.dndScheduleEndHour()).toBe(7);
            expect(f.service.dnd).toBe(true);
            expect(f.activeTimers).toBe(0);
            expect(f.writes).toEqual([]);
        });
    });

    it('loads a persisted enabled schedule after a fresh service and settings instance', () => {
        withFixture({hour: 10}, (f) => {
            f.settings.setDndScheduleStartHour(9);
            f.settings.setDndScheduleEndHour(17);
            f.settings.setDndScheduleEnabled(true);
            const reopened = f.restart();
            expect(reopened.get_boolean('dnd-schedule-enabled')).toBe(true);
            expect(reopened.get_int('dnd-schedule-start-hour')).toBe(9);
            expect(reopened.get_int('dnd-schedule-end-hour')).toBe(17);
            expect(f.service.dnd).toBe(true);
            expect(f.activeTimers).toBe(1);
            f.tick(17);
            expect(f.service.dnd).toBe(false);
        });
    });

    it('reads native DND before applying the schedule and restores it on disable', () => {
        withFixture({hour: 23, enabled: true}, (f) => {
            expect(f.service.dnd).toBe(true);
            f.settings.setDndScheduleEnabled(false);
            expect(f.service.dnd).toBe(false);
            expect(f.writes).toEqual([true, false]);
            expect(f.activeTimers).toBe(0);
        });
    });

    it('leaves manual DND alone when enabled outside the window', () => {
        withFixture({hour: 12, dnd: true, enabled: true}, (f) => {
            expect(f.service.dnd).toBe(true);
            expect(f.writes).toEqual([]);
            f.tick(22);
            f.tick(7);
            expect(f.service.dnd).toBe(false);
            f.settings.setDndScheduleEnabled(false);
            expect(f.service.dnd).toBe(true);
        });
    });

    it('keeps manual overrides through polling and midnight until the next boundary', () => {
        withFixture({hour: 23, enabled: true}, (f) => {
            bus.emit('system:dnd:toggle');
            expect(f.service.dnd).toBe(false);
            f.tick(0);
            f.tick(6);
            expect(f.writes).toEqual([true, false]);
            f.tick(7);
            bus.emit('system:dnd:set', true);
            f.tick(12);
            expect(f.service.dnd).toBe(true);
            f.tick(22);
            expect(f.service.dnd).toBe(true);
            f.tick(7);
            expect(f.service.dnd).toBe(false);
        });
    });

    it('does not restore over a manual change even when it matches the last scheduled value', () => {
        withFixture({hour: 12, dnd: true, enabled: true}, (f) => {
            f.tick(22);
            f.tick(7);
            bus.emit('system:dnd:toggle');
            bus.emit('system:dnd:toggle');
            expect(f.service.dnd).toBe(false);
            f.settings.setDndScheduleEnabled(false);
            expect(f.service.dnd).toBe(false);
            expect(f.activeTimers).toBe(0);
        });
    });

    it('applies edited boundaries immediately but preserves a manual override within the window', () => {
        withFixture({hour: 12, enabled: true}, (f) => {
            f.settings.setDndScheduleStartHour(13);
            f.settings.setDndScheduleEndHour(17);
            expect(f.service.dnd).toBe(false);
            f.settings.setDndScheduleStartHour(9);
            expect(f.service.dnd).toBe(true);
            f.service.dnd = false;
            f.settings.setDndScheduleEndHour(18);
            expect(f.service.dnd).toBe(false);
            f.settings.setDndScheduleStartHour(13);
            f.service.dnd = true;
            f.tick(12);
            expect(f.service.dnd).toBe(true);
            f.tick(13);
            f.tick(18);
            expect(f.service.dnd).toBe(false);
        });
    });

    it('treats matching hours as an empty window instead of all-day DND', () => {
        withFixture({hour: 12, enabled: true, start: 8, end: 8}, (f) => {
            f.tick(8);
            f.tick(23);
            expect(f.writes).toEqual([]);
            f.settings.setDndScheduleEndHour(7);
            expect(f.service.dnd).toBe(true);
            f.settings.setDndScheduleEndHour(8);
            expect(f.service.dnd).toBe(false);
        });
    });

    it('keeps a single shell-owned timer across repeated init and preference changes', () => {
        withFixture({hour: 23, enabled: true}, (f) => {
            f.service.init(f.settings);
            f.settings.setDndScheduleEndHour(8);
            f.settings.setDndScheduleStartHour(21);
            expect(f.timerStarts).toBe(1);
            expect(f.activeTimers).toBe(1);
            f.settings.setDndScheduleEnabled(false);
            f.settings.setDndScheduleEnabled(true);
            expect(f.timerStarts).toBe(2);
            expect(f.activeTimers).toBe(1);
        });
    });

    it('removes its timer, settings subscriptions and bus listeners at shell disposal', () => {
        withFixture({hour: 23, enabled: true}, (f) => {
            f.service.dispose();
            expect(f.activeTimers).toBe(0);
            expect(f.service.dnd).toBe(false);
            const writes = f.writes.length;
            f.settings.setDndScheduleEndHour(8);
            f.settings.setDndScheduleEnabled(false);
            f.settings.setDndScheduleEnabled(true);
            bus.emit('system:dnd:toggle');
            f.tick(23);
            expect(f.activeTimers).toBe(0);
            expect(f.writes.length).toBe(writes);
            expect(f.service.dnd).toBe(false);
        });
    });

    it('retains schedule and manual boundary behavior without a notification daemon', () => {
        withFixture({hour: 23, enabled: true, daemonAvailable: false}, (f) => {
            expect(f.service.dnd).toBe(true);
            f.service.toggle();
            f.tick(0);
            expect(f.service.dnd).toBe(false);
            f.tick(7);
            f.tick(22);
            expect(f.service.dnd).toBe(true);
            expect(f.writes).toEqual([]);
        });
    });
});

await run(import.meta.url);
