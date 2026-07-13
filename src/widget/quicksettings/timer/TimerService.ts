import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib?version=2.0';
import GObject, {getter, register} from 'gnim/gobject';
import logger from '#/lib/core/logger';
import {fmtDuration} from '#/lib/core/time';

export type TimerMode = 'none' | 'countdown' | 'pomodoro';

@register({GTypeName: 'TimerService'})
export default class TimerService extends GObject.Object {
    static readonly instance: TimerService;
    static get_default() {
        if (!this.instance) this.instance = new TimerService();
        return this.instance;
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

    /** Timer tick interval in milliseconds. */
    static readonly TICK_MS = 1000;

    // ── Pomodoro settings ──
    #workDuration = 25 * 60 * 1000;
    #breakDuration = 5 * 60 * 1000;
    #longBreakDuration = 15 * 60 * 1000;
    #sessionsBeforeLongBreak = 4;

    @getter(Number)
    get remaining() {
        return this.#remaining;
    }

    @getter(Number)
    get total() {
        return this.#total;
    }

    @getter(Boolean)
    get running() {
        return this.#running;
    }

    @getter(String)
    get mode() {
        return this.#mode;
    }

    @getter(String)
    get label() {
        return this.#label;
    }

    @getter(Number)
    get pomodoroSession() {
        return this.#pomodoroSession;
    }

    @getter(Boolean)
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
        this.#workDuration = workMin * 60 * 1000;
        this.#breakDuration = breakMin * 60 * 1000;
        this.#longBreakDuration = longBreakMin * 60 * 1000;
        this.#sessionsBeforeLongBreak = sessionsBeforeLongBreak;
    }

    // ── Internal ──

    #startTick() {
        this.#stopTick();
        this.#running = true;
        this.notify('running');
        this.#tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TimerService.TICK_MS, () => {
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
        });
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
            return this.#pomodoroIsBreak ? 'Break over! Back to work.' : 'Work session complete!';
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
            print(`[Timer] ${title} — ${body}`);
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
            print(`[Timer] ${title} — ${body}`);
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
