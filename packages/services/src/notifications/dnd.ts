import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {generalSettings} from '@shade/core/settings/general.gschema';
import type {Accessor} from 'gnim';
import {Object, property, register} from 'gnim/gobject';
import {bus} from '../bus';
import {isHourInDndWindow} from './dndSchedule';
import {getNotifdSafe} from './guard';

interface DndScheduleSettings {
    dndScheduleEnabled: Accessor<boolean>;
    dndScheduleStartHour: Accessor<number>;
    dndScheduleEndHour: Accessor<number>;
}

interface DndServiceDependencies {
    getNotifd?: () => {dontDisturb: boolean} | null;
    currentHour?: () => number;
    startTimer?: (callback: () => void) => () => void;
}

function startScheduleTimer(callback: () => void): () => void {
    const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
        callback();
        return GLib.SOURCE_CONTINUE;
    });
    return () => {
        GLib.source_remove(id);
    };
}

/**
 * Centralized Do Not Disturb service.
 *
 * Wraps AstalNotifd's dontDisturb behind a clean GObject interface.
 * Listens to bus events and emits changes so any widget or service
 * can react without importing AstalNotifd directly.
 *
 * Usage:
 * ```ts
 * import DndService from './dnd';
 *
 * DndService.get_default().dnd = true;       // enable DND
 * bus.emit('system:dnd:toggle');              // toggle via bus
 * ```
 *
 * If AstalNotifd is unavailable (foreign daemon), DND state is
 * stored locally and the dnd property still works for UI toggling,
 * but notifications won't actually be suppressed.
 *
 * The daily schedule is stored in general GSettings and owned by this
 * shell-lifetime service, not the Settings page. Manual DND changes last
 * until the next schedule boundary, including when no daemon is available.
 */
@register
export default class DndService extends Object {
    private static instance: DndService;

    static get_default() {
        if (!DndService.instance) DndService.instance = new DndService();
        return DndService.instance;
    }

    #dnd = false;
    #subscriptions: (() => void)[] = [];
    #initialized = false;
    #settings: DndScheduleSettings | null = null;
    #getNotifd: () => {dontDisturb: boolean} | null;
    #currentHour: () => number;
    #startTimer: (callback: () => void) => () => void;
    #stopTimer: (() => void) | null = null;
    #priorDnd: boolean | null = null;
    #inWindow = false;
    #lastSet: boolean | null = null;

    constructor(dependencies: DndServiceDependencies = {}) {
        super();
        this.#getNotifd = dependencies.getNotifd ?? getNotifdSafe;
        this.#currentHour = dependencies.currentHour ?? (() => new Date().getHours());
        this.#startTimer = dependencies.startTimer ?? startScheduleTimer;
    }

    @property
    get dnd() {
        return this.#dnd;
    }

    set dnd(v: boolean) {
        // Only boundary writes belong to the schedule, even if a manual
        // change later returns to the same value.
        this.#lastSet = null;
        this.#setDnd(v);
    }

    #setDnd(v: boolean): void {
        if (this.#dnd === v) return;
        this.#dnd = v;
        this.#syncToNotifd(v);
        logger.info('dnd', `DND ${v ? 'enabled' : 'disabled'}`);
        this.notify('dnd');
    }

    toggle() {
        this.dnd = !this.#dnd;
    }

    init(settings: DndScheduleSettings): void {
        if (this.#initialized) return;
        this.#initialized = true;
        this.#settings = settings;

        // The registered dependency has already resolved Notifd. Read its
        // baseline before enabling the schedule so it cannot overwrite the
        // first boundary write in a later idle callback.
        const notifd = this.#getNotifd();
        if (notifd) {
            this.#dnd = notifd.dontDisturb;
            this.notify('dnd');
        }

        const syncSchedule = () => this.#syncSchedule();
        this.#subscriptions.push(
            settings.dndScheduleEnabled.subscribe(syncSchedule),
            settings.dndScheduleStartHour.subscribe(syncSchedule),
            settings.dndScheduleEndHour.subscribe(syncSchedule),
            bus.on('system:dnd:toggle', () => this.toggle()),
            bus.on('system:dnd:set', (v) => {
                this.dnd = v;
            })
        );
        this.#syncSchedule();
    }

    #syncSchedule(): void {
        if (!this.#settings?.dndScheduleEnabled()) {
            this.#stopSchedule();
            return;
        }
        if (this.#stopTimer === null) {
            this.#priorDnd = this.#dnd;
            this.#inWindow = false;
            this.#lastSet = null;
            this.#stopTimer = this.#startTimer(() => this.#syncDnd());
        }
        this.#syncDnd();
    }

    #syncDnd(): void {
        const settings = this.#settings;
        if (!settings?.dndScheduleEnabled()) return;
        const next = isHourInDndWindow(
            this.#currentHour(),
            settings.dndScheduleStartHour(),
            settings.dndScheduleEndHour()
        );
        // Do not reassert a value between boundaries: manual toggles win.
        if (next === this.#inWindow) return;
        this.#inWindow = next;
        this.#lastSet = next;
        this.#setDnd(next);
    }

    #stopSchedule(): void {
        this.#stopTimer?.();
        this.#stopTimer = null;
        const restore =
            this.#priorDnd !== null && this.#lastSet !== null && this.#dnd === this.#lastSet
                ? this.#priorDnd
                : null;
        this.#priorDnd = null;
        this.#lastSet = null;
        this.#inWindow = false;
        if (restore !== null) this.#setDnd(restore);
    }

    #syncToNotifd(v: boolean): void {
        const notifd = this.#getNotifd();
        if (notifd) {
            notifd.dontDisturb = v;
        }
    }

    dispose(): void {
        for (const unsub of this.#subscriptions) {
            unsub();
        }
        this.#subscriptions = [];
        this.#stopSchedule();
        this.#settings = null;
        this.#initialized = false;
    }
}

defineService({
    name: 'DndService',
    service: DndService.get_default(),
    dependsOn: ['Notifd (pre-init)'],
    initArgs: () => [generalSettings()],
});
