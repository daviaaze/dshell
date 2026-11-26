import type Notifd from 'gi://AstalNotifd';
import type Wireplumber from 'gi://AstalWp';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import ServiceRegistry from '@shade/core/serviceRegistry';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {Object as GObject, property, register} from 'gnim/gobject';
import {bus} from '../bus';
import type {SystemAlert} from '../notifications/alerts';
import {getNotifdSafe, onNotifdRecovered} from '../notifications/guard';
import SystemAlertService from '../notifications/systemAlerts';
import type ShellState from '../state/shellState';
import type AudioController from './audioController';

const SOUND_CATEGORIES = {
    'message-new-instant': 'notification',
    'screen-capture': 'capture',
    'service-login': 'capture',
    'battery-low': 'battery',
    'battery-caution': 'battery',
    'screen-lock': 'system',
    'screen-unlock': 'system',
    'power-plug': 'power',
    'power-unplug': 'power',
    'device-added': 'bluetooth',
    'device-removed': 'bluetooth',
    'dialog-warning': 'temperature',
    'dialog-error': 'temperature',
    'audio-volume-change': 'volume',
} as const;

export type SoundId = keyof typeof SOUND_CATEGORIES;
type SoundCategory = (typeof SOUND_CATEGORIES)[SoundId];
export type SoundPolicy = {enabled: boolean; dnd: boolean} & Record<SoundCategory, boolean>;
type Settings = ReturnType<typeof generalSettings>;

/** The shell preloads GTK4 layer-shell; canberra-gtk-play is a GTK3 executable. */
export function soundProcessPreload(inherited: string | null): string | null {
    return inherited?.split(/[\s:]+/).filter((entry) =>
        entry.length > 0 && !/(^|\/)libgtk4-layer-shell\.so(?:\.\d+)*$/.test(entry)
    ).join(':') || null;
}

/** Sanitize only this child: do not change the GTK4 shell's process environment. */
export function spawnSoundProcess(argv: string[]): Promise<string> {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    const preload = soundProcessPreload(GLib.getenv('LD_PRELOAD'));
    if (preload === null) launcher.unsetenv('LD_PRELOAD');
    else launcher.setenv('LD_PRELOAD', preload, true);
    const child = launcher.spawnv(argv);
    const {promise, resolve, reject} = Promise.withResolvers<string>();
    child.communicate_utf8_async(null, null, (_source, result) => {
        try {
            const [, output, error] = child.communicate_utf8_finish(result);
            if (child.get_successful()) {
                resolve(output ?? '');
            } else {
                const status = child.get_if_signaled() ? `signal ${child.get_term_sig()}`
                    : `status ${child.get_exit_status()}`;
                reject(new Error(error?.trim() || `Sound process terminated with ${status}`));
            }
        } catch (error) { reject(error); }
    });
    return promise;
}

interface SoundRuntime {
    available(): boolean;
    now(): number;
    spawn(argv: string[]): Promise<string>;
    failed(error: unknown): void;
}

/** The subprocess boundary is injectable; the real playback gate is exercised without audio hardware. */
export class SoundPlayer {
    #lastPlay = new Map<SoundId, number>();

    constructor(
        private readonly policy: () => SoundPolicy,
        private readonly runtime: SoundRuntime
    ) {}

    play(soundId: SoundId): void {
        // Runtime callers also fail closed, even if they bypass TypeScript.
        if (!Object.hasOwn(SOUND_CATEGORIES, soundId)) return;
        const policy = this.policy();
        if (!policy.enabled || policy.dnd || !policy[SOUND_CATEGORIES[soundId]]) return;
        const now = this.runtime.now();
        const category = SOUND_CATEGORIES[soundId];
        const interval = category === 'bluetooth' ? 1000
            : category === 'capture' || category === 'power' ? 300 : category === 'volume' ? 80 : 0;
        if (now - (this.#lastPlay.get(soundId) ?? -Infinity) < interval) return;
        if (!this.runtime.available()) return;
        try {
            this.runtime.spawn(['canberra-gtk-play', '--id', soundId]).catch((error) => this.runtime.failed(error));
            this.#lastPlay.set(soundId, now);
        } catch (error) {
            this.runtime.failed(error);
        }
    }
}

/** Notification IDs identify arrivals, not each update of a progress or media notification. */
export class NotificationSoundTracker {
    #seen = new Set<number>();

    seed(ids: number[]): void {
        this.#seen = new Set(ids);
    }

    shouldPlay(id: number, appName: string, replaced: boolean, ignoredApps: string[]): boolean {
        const seen = this.#seen.has(id);
        this.#seen.add(id);
        const name = appName.toLowerCase();
        return !seen && !replaced && name !== 'shade'
            && !ignoredApps.some((ignored) => ignored.toLowerCase() === name);
    }

    remove(id: number): void {
        this.#seen.delete(id);
    }
}

/**
 * Freedesktop theme feedback. Hardware sounds consume SystemAlerts decisions,
 * never independent battery edges or every UPower device add/remove signal.
 */
@register
export default class SoundAlertService extends GObject {
    private static instance: SoundAlertService;

    static get_default() {
        if (!SoundAlertService.instance) SoundAlertService.instance = new SoundAlertService();
        return SoundAlertService.instance;
    }

    #settings: Settings | null = null;
    #enabled = true;
    #unsubscribers: (() => void)[] = [];
    #connections: {source: {disconnect(id: number): void}; id: number}[] = [];
    #notifd: Notifd.Notifd | null = null;
    #notifdHandlers: number[] = [];
    #notifdIdle = 0;
    #notifications = new NotificationSoundTracker();
    #canberraAvailable: boolean | null = null;
    #volumeEndpoint: Wireplumber.Endpoint | null = null;
    #volumeHandler = 0;
    #lastVolume = 0;
    #player = new SoundPlayer(() => this.#policy(), {
        available: () => this.#canberraUsable(),
        now: () => GLib.get_monotonic_time() / 1000,
        spawn: spawnSoundProcess,
        failed: (error) => logger.debug('sound', 'Could not play sound:', error),
    });

    @property
    get enabled() {
        return this.#enabled;
    }

    set enabled(value: boolean) {
        if (this.#enabled === value) return;
        this.#enabled = value;
        this.notify('enabled');
    }

    init(settings: Settings): void {
        if (this.#settings) return;
        this.#settings = settings;
        this.enabled = settings.soundAlertsEnabled();
        this.#unsubscribers.push(settings.soundAlertsEnabled.subscribe(() => {
            this.enabled = settings.soundAlertsEnabled();
        }));

        for (const event of ['capture:screenshot', 'capture:screenshot:area', 'capture:screenshot:overlay'] as const) {
            this.#unsubscribers.push(bus.on(event, () => this.play('screen-capture')));
        }
        for (const event of ['capture:record', 'capture:record:area', 'capture:record:window', 'capture:record:output'] as const) {
            this.#unsubscribers.push(bus.on(event, () => this.play('service-login')));
        }
        this.#unsubscribers.push(bus.on('shell:lockscreen', () => this.play('screen-lock')));
        const shell = ServiceRegistry.get_default().resolve<ShellState>('ShellState');
        this.#connections.push({source: shell, id: shell.connect('notify', (_source, pspec) => {
            if (pspec.get_name() === 'screenlocked' && !shell.screenlocked) this.play('screen-unlock');
        })});

        this.#unsubscribers.push(SystemAlertService.get_default().onAlert((alert) => this.#systemAlert(alert)));
        this.#unsubscribers.push(onNotifdRecovered(() => this.#connectNotifd()));
        this.#notifdIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#notifdIdle = 0;
            this.#connectNotifd();
            return GLib.SOURCE_REMOVE;
        });
        const audio = ServiceRegistry.get_default().resolve<AudioController>('AudioController');
        this.#connections.push({source: audio, id: audio.connect('notify', (_source, pspec) => {
            if (pspec.get_name() === 'default-speaker') this.#wireVolume(audio.defaultSpeaker);
        })});
        this.#wireVolume(audio.defaultSpeaker);
    }

    #policy(): SoundPolicy {
        const settings = this.#settings;
        let dnd = true;
        try {
            dnd = ServiceRegistry.get_default().resolve<{dnd: boolean}>('DndService').dnd;
        } catch {
            // An unknown DND state is not permission to make noise.
        }
        return {
            enabled: this.#enabled && settings !== null,
            dnd,
            notification: settings?.soundAlertNotification() ?? false,
            capture: settings?.soundAlertCapture() ?? false,
            battery: settings?.soundAlertBattery() ?? false,
            system: settings?.soundAlertSystem() ?? false,
            power: settings?.soundAlertPower() ?? false,
            bluetooth: settings?.soundAlertBluetooth() ?? false,
            temperature: settings?.soundAlertTemperature() ?? false,
            volume: settings?.soundAlertVolume() ?? false,
        };
    }

    #systemAlert(alert: SystemAlert): void {
        if (this.#settings?.notificationIgnoredApps().some((name) => name.toLowerCase() === 'shade')) return;
        switch (alert.kind) {
            case 'battery-low': case 'bluetooth-battery-low': this.play('battery-low'); break;
            case 'battery-critical': this.play('battery-caution'); break;
            case 'power-plug': this.play('power-plug'); break;
            case 'power-unplug': this.play('power-unplug'); break;
            case 'bluetooth-connected': this.play('device-added'); break;
            case 'bluetooth-disconnected': this.play('device-removed'); break;
            case 'temperature-warning': this.play('dialog-warning'); break;
            case 'temperature-critical': this.play('dialog-error'); break;
        }
    }

    #connectNotifd(): void {
        if (!this.#settings) return;
        const notifd = getNotifdSafe();
        if (this.#notifd === notifd) return;
        this.#disconnectNotifd();
        if (!notifd) return;
        this.#notifd = notifd;
        this.#notifications.seed(notifd.get_notifications().map((notification) => notification.id));
        this.#notifdHandlers.push(notifd.connect('notified', (_daemon, id, replaced) => {
            const notification = notifd.get_notification(id);
            if (notification && this.#notifications.shouldPlay(
                id, notification.appName ?? '', replaced, this.#settings?.notificationIgnoredApps() ?? []
            )) this.play('message-new-instant');
        }));
        this.#notifdHandlers.push(notifd.connect('resolved', (_daemon, id) => this.#notifications.remove(id)));
    }

    #disconnectNotifd(): void {
        for (const id of this.#notifdHandlers) this.#notifd?.disconnect(id);
        this.#notifdHandlers = [];
        this.#notifd = null;
        this.#notifications.seed([]);
    }

    #wireVolume(endpoint: Wireplumber.Endpoint | null): void {
        if (endpoint === this.#volumeEndpoint) return;
        if (this.#volumeEndpoint && this.#volumeHandler) this.#volumeEndpoint.disconnect(this.#volumeHandler);
        this.#volumeEndpoint = endpoint;
        this.#volumeHandler = 0;
        if (!endpoint) return;
        this.#lastVolume = endpoint.volume;
        this.#volumeHandler = endpoint.connect('notify::volume', () => {
            const changed = this.#lastVolume !== endpoint.volume;
            this.#lastVolume = endpoint.volume;
            if (changed && !endpoint.mute) this.play('audio-volume-change');
        });
    }

    /** Typed, runtime-allowlisted argv playback; missing themes/programs remain silent. */
    play(soundId: SoundId): void {
        this.#player.play(soundId);
    }

    #canberraUsable(): boolean {
        if (this.#canberraAvailable === null) {
            this.#canberraAvailable = GLib.find_program_in_path('canberra-gtk-play') !== null;
            if (!this.#canberraAvailable) logger.warn('sound', 'canberra-gtk-play not found — sound alerts disabled');
        }
        return this.#canberraAvailable;
    }

    dispose(): void {
        if (this.#notifdIdle) GLib.source_remove(this.#notifdIdle);
        this.#notifdIdle = 0;
        for (const unsubscribe of this.#unsubscribers) unsubscribe();
        this.#unsubscribers = [];
        for (const {source, id} of this.#connections) source.disconnect(id);
        this.#connections = [];
        this.#wireVolume(null);
        this.#disconnectNotifd();
        this.#settings = null;
    }
}

defineService({name: 'SoundAlerts', service: SoundAlertService.get_default(),
    dependsOn: ['SystemAlerts', 'DndService', 'ShellState', 'AudioController'],
    initArgs: () => [generalSettings()]});
