import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib?version=2.0';
import {Object, register, property} from 'gnim/gobject';
import {bus} from '../bus';
import logger from '@shade/core/logger';
import {fmtDuration} from '@shade/core/time';
import {defineService} from '@shade/core/define';
import {timerSettings} from './timer.gschema';

export type TimerMode = 'none' | 'countdown' | 'pomodoro';

@register
export default class TimerService extends Object {
    private static instance: TimerService;
    static get_default() {
        if (!this.instance) {
            this.instance = new TimerService();
            this.instance.#initBus();
        }
        return this.instance;
    }

    #initBus() {
        this.#busSubscriptions.push(
            bus.on('timer:cmd:start-countdown', ms => this.startCountdown(ms))
        );
        this.#busSubscriptions.push(
            bus.on('timer:cmd:start-pomodoro', () => this.startPomodoro())
        );
        this.#busSubscriptions.push(
            bus.on('timer:cmd:pause', () => this.pause())
        );
        this.#busSubscriptions.push(
            bus.on('timer:cmd:resume', () => this.resume())
        );
        this.#busSubscriptions.push(
            bus.on('timer:cmd:cancel', () => this.cancel())
        );
    }

    // ── GObject properties ──
    #remaining = -1;
    #total = 0;
    #running = false;
    #mode: TimerMode = 'none';
    #label = '';
    #pomodoroSession = 0;
    #pomodoroIsBreak = false;

    // ── Internal ──
    #tickId: number | null = null;
    #app: Adw.Application | null = null;
    #initialized = false;
    #notificationId = 0;
    #busSubscriptions: (() => void)[] = [];

    /** Timer tick interval in milliseconds. */
    static readonly TICK_MS = 1000;

    // ── Default durations (overridden by init()) ──
    static readonly DEFAULT_WORK_MIN = 25;
    static readonly DEFAULT_BREAK_MIN = 5;
    static readonly DEFAULT_LONG_BREAK_MIN = 15;
    static readonly DEFAULT_SESSIONS_BEFORE_LONG = 4;

    static readonly MS_PER_MIN = 60 * 1000;

    // ── Pomodoro settings ──
    #workDuration = TimerService.DEFAULT_WORK_MIN * TimerService.MS_PER_MIN;
    #breakDuration = TimerService.DEFAULT_BREAK_MIN * TimerService.MS_PER_MIN;
    #longBreakDuration =
        TimerService.DEFAULT_LONG_BREAK_MIN * TimerService.MS_PER_MIN;
    #sessionsBeforeLongBreak = TimerService.DEFAULT_SESSIONS_BEFORE_LONG;

    @property
    get remaining() {
        return this.#remaining;
    }

    @property
    get total() {
        return this.#total;
    }

    @property
    get running() {
        return this.#running;
    }

    @property
    get mode() {
        return this.#mode;
    }

    @property
    get label() {
        return this.#label;
    }

    @property
    get pomodoroSession() {
        return this.#pomodoroSession;
    }

    @property
    get pomodoroIsBreak() {
        return this.#pomodoroIsBreak;
    }

    // ── Public API ──

    startCountdown(ms: number, customLabel?: string) {
        this.#cancelTimer();
        this.#remaining = ms;
        this.#total = ms;
        this.#mode = 'countdown';
        this.#label = customLabel || fmtDuration(ms);
        this.#notifyAll();
        this.#startTick();
    }

    startPomodoro() {
        this.#cancelTimer();
        this.#pomodoroSession = 1;
        this.#pomodoroIsBreak = false;
        this.#remaining = this.#workDuration;
        this.#total = this.#workDuration;
        this.#mode = 'pomodoro';
        this.#label = `Work — Session 1`;
        this.#notifyAll();
        this.#startTick();
    }

    pause() {
        if (!this.#running) return;
        this.#stopTick();
        this.#running = false;
        this.notify('running');
    }

    resume() {
        if (this.#running || this.#remaining <= 0) return;
        this.#startTick();
    }

    cancel() {
        this.#cancelTimer();
        this.#remaining = -1;
        this.#total = 0;
        this.#mode = 'none';
        this.#label = '';
        this.#pomodoroSession = 0;
        this.#pomodoroIsBreak = false;
        this.#notifyAll();
    }

    init(
        app: Adw.Application,
        workMin: number,
        breakMin: number,
        longBreakMin: number,
        sessionsBeforeLongBreak: number
    ) {
        if (this.#initialized) return;
        this.#initialized = true;
        this.#app = app;
        this.#workDuration = workMin * TimerService.MS_PER_MIN;
        this.#breakDuration = breakMin * TimerService.MS_PER_MIN;
        this.#longBreakDuration = longBreakMin * TimerService.MS_PER_MIN;
        this.#sessionsBeforeLongBreak = sessionsBeforeLongBreak;
    }

    // ── Internal ──

    #startTick() {
        this.#stopTick();
        this.#running = true;
        this.notify('running');
        this.#tickId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            TimerService.TICK_MS,
            () => {
                this.#remaining -= TimerService.TICK_MS;
                if (this.#remaining <= 0) {
                    this.#remaining = 0;
                    this.notify('remaining');
                    this.#stopTick();
                    this.#running = false;
                    this.notify('running');
                    this.#onComplete();
                    return GLib.SOURCE_REMOVE;
                }
                this.notify('remaining');
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    #stopTick() {
        if (this.#tickId) {
            GLib.source_remove(this.#tickId);
            this.#tickId = null;
        }
    }

    #cancelTimer() {
        this.#stopTick();
        this.#running = false;
    }

    #onComplete() {
        const isPomodoro = this.#mode === 'pomodoro';
        const title = (() => {
            if (!isPomodoro) return 'Timer finished!';
            return this.#pomodoroIsBreak
                ? 'Break over! Back to work.'
                : 'Work session complete!';
        })();
        const body = isPomodoro
            ? `Session ${this.#pomodoroSession} complete.`
            : this.#label;

        this.#sendNotification(title, body);

        if (isPomodoro) {
            if (this.#pomodoroIsBreak) {
                // Break over → next work segment
                this.#pomodoroSession++;
                this.#pomodoroIsBreak = false;
                this.#remaining = this.#workDuration;
                this.#total = this.#workDuration;
                this.#label = `Work — Session ${this.#pomodoroSession}`;
            } else {
                // Work done → break
                this.#pomodoroIsBreak = true;
                const isLong =
                    this.#pomodoroSession % this.#sessionsBeforeLongBreak === 0;
                this.#remaining = isLong
                    ? this.#longBreakDuration
                    : this.#breakDuration;
                this.#total = this.#remaining;
                this.#label = isLong ? 'Long Break' : 'Break';
            }
            this.#notifyAll();
            this.#startTick();
        } else {
            this.#remaining = -1;
            this.#total = 0;
            this.#label = '';
            this.#mode = 'none';
            this.#notifyAll();
        }
    }

    #sendNotification(title: string, body: string) {
        if (!this.#app) {
            logger.log(`[Timer] ${title} — ${body}`);
            return;
        }
        try {
            const n = new Gio.Notification();
            n.set_title(title);
            n.set_body(body);
            n.set_icon(Gio.Icon.new_for_string('alarm-symbolic'));
            this.#notificationId++;
            const id = `timer-${this.#notificationId}`;
            this.#app.send_notification(id, n);
        } catch (e) {
            logger.warn('timer', 'Failed to send notification:', e);
            logger.log(`[Timer] ${title} — ${body}`);
        }
    }

    #notifyAll() {
        this.notify('remaining');
        this.notify('total');
        this.notify('running');
        this.notify('mode');
        this.notify('label');
        this.notify('pomodoro-session');
        this.notify('pomodoro-is-break');
    }
}

defineService({
    name: 'TimerService',
    service: TimerService.get_default(),
    initArgs: (ctx) => [
        ctx.app,
        timerSettings().pomodoroWorkDuration(),
        timerSettings().pomodoroBreakDuration(),
        timerSettings().pomodoroLongBreakDuration(),
        timerSettings().pomodoroSessionsBeforeLongBreak(),
    ],
});
