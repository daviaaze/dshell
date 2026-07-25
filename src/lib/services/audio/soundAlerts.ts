import {Object, register, property} from 'gnim/gobject';
import GLib from 'gi://GLib?version=2.0';
import AstalBattery from 'gi://AstalBattery';
import {bus} from '#/lib/core/eventBus';
import ServiceRegistry from '#/lib/core/serviceRegistry';
import {getNotifdSafe} from '#/lib/services/notifications/guard';
import {Process} from '#/lib/core/process';
import logger from '#/lib/core/logger';
import type {Accessor} from 'gnim';

/** Fraction (0..1) at which low-battery warning sounds fire. */
const LOW_BATTERY_THRESHOLD = 0.15;

type SoundCategory = 'notification' | 'capture' | 'battery' | 'system';

/**
 * System-wide sound alerts using the freedesktop.org sound theme.
 *
 * Plays sounds via `canberra-gtk-play` in response to:
 * - Notification arrivals (AstalNotifd)
 * - Screenshot/recording events (bus)
 * - Low battery warnings (AstalBattery)
 * - Screen lock/unlock (ShellState + bus)
 * - Power plug/unplug (AstalBattery UPower)
 * - Device added/removed (AstalBattery UPower)
 *
 * DND-aware: skips sounds when DndService.dnd is true.
 * Configurable: each category can be toggled via GSettings.
 */
@register({GTypeName: 'SoundAlertService'})
export default class SoundAlertService extends Object {
    static instance: SoundAlertService;

    static get_default() {
        if (!this.instance) this.instance = new SoundAlertService();
        return this.instance;
    }

    #enabled = true;
    #notificationEnabled = true;
    #captureEnabled = true;
    #batteryEnabled = true;
    #systemEnabled = true;
    #busUnsubs: (() => void)[] = [];
    #shellStateHandlerId = 0;
    #notifdHandlerId = 0;
    #batteryHandlerId = 0;
    #upowerHandlerIds: number[] = [];
    #upowerInstance: AstalBattery.UPower | null = null;
    #lastBatteryPercentage = 1.0;
    #initialized = false;
    #shellState: {v?: import('#/lib/services/state/shellState').default} = {};
    #dndService: {v?: import('#/lib/services/notifications/dnd').default} = {};

    /** Resolve a dependency from the service registry. */
    /** Resolve a dependency from the service registry (lazy). */
    #getDep<T>(name: string, cache: {v?: T}): T {
        if (!cache.v) cache.v = ServiceRegistry.get_default().resolve<T>(name);
        return cache.v;
    }

    get #shell(): import('#/lib/services/state/shellState').default {
        return this.#getDep('ShellState', this.#shellState);
    }

    get #dnd(): import('#/lib/services/notifications/dnd').default {
        return this.#getDep('DndService', this.#dndService);
    }

    @property(Object)
    get enabled() {
        return this.#enabled;
    }

    
    set enabled(v: boolean) {
        if (this.#enabled === v) return;
        this.#enabled = v;
        this.notify('enabled');
    }

    init(settings: {
        soundAlertsEnabled: Accessor<boolean>;
        soundAlertNotification: Accessor<boolean>;
        soundAlertCapture: Accessor<boolean>;
        soundAlertBattery: Accessor<boolean>;
        soundAlertSystem: Accessor<boolean>;
    }): void {
        if (this.#initialized) return;
        this.#initialized = true;

        // Read initial settings
        this.#enabled = settings.soundAlertsEnabled();
        this.#notificationEnabled = settings.soundAlertNotification();
        this.#captureEnabled = settings.soundAlertCapture();
        this.#batteryEnabled = settings.soundAlertBattery();
        this.#systemEnabled = settings.soundAlertSystem();

        // Subscribe to live settings changes
        settings.soundAlertsEnabled.subscribe(() => {
            this.#enabled = settings.soundAlertsEnabled();
        });
        settings.soundAlertNotification.subscribe(() => {
            this.#notificationEnabled = settings.soundAlertNotification();
        });
        settings.soundAlertCapture.subscribe(() => {
            this.#captureEnabled = settings.soundAlertCapture();
        });
        settings.soundAlertBattery.subscribe(() => {
            this.#batteryEnabled = settings.soundAlertBattery();
        });
        settings.soundAlertSystem.subscribe(() => {
            this.#systemEnabled = settings.soundAlertSystem();
        });

        // ── Bus events ──

        this.#busUnsubs.push(
            bus.on('capture:screenshot', () => this.play('screen-capture'))
        );
        this.#busUnsubs.push(
            bus.on('capture:screenshot:area', () =>
                this.play('screen-capture')
            )
        );
        this.#busUnsubs.push(
            bus.on('capture:screenshot:overlay', () =>
                this.play('screen-capture')
            )
        );
        this.#busUnsubs.push(
            bus.on('capture:record', () => this.play('service-login'))
        );
        this.#busUnsubs.push(
            bus.on('capture:record:area', () => this.play('service-login'))
        );
        this.#busUnsubs.push(
            bus.on('capture:record:window', () => this.play('service-login'))
        );
        this.#busUnsubs.push(
            bus.on('capture:record:output', () => this.play('service-logout'))
        );
        this.#busUnsubs.push(
            bus.on('shell:lockscreen', () => this.play('screen-lock'))
        );

        // ── Screen unlock — listen to ShellState ──

        this.#shellStateHandlerId = this.#shell.connect(
            'notify',
            (_source, pspec) => {
                if (pspec.get_name() === 'screenlocked' && !this.#shell.screenlocked) {
                    this.play('screen-unlock');
                }
            }
        );

        // ── External services (deferred) ──

        this.#connectNotifd();
        this.#connectBattery();
        this.#connectUPower();
    }

    #connectNotifd(): void {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const notifd = getNotifdSafe();
            if (!notifd) return GLib.SOURCE_REMOVE;
            this.#notifdHandlerId = notifd.connect('notified', () => {
                this.play('message-new-instant');
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    #connectBattery(): void {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try {
                const battery = AstalBattery.get_default();
                this.#lastBatteryPercentage = battery.percentage;
                this.#batteryHandlerId = battery.connect(
                    'notify::percentage',
                    () => {
                        const pct = battery.percentage;
                        const wasAbove = this.#lastBatteryPercentage >
                            LOW_BATTERY_THRESHOLD;
                        const isNowBelow = pct <= LOW_BATTERY_THRESHOLD;
                        this.#lastBatteryPercentage = pct;
                        if (wasAbove && isNowBelow && battery.isPresent) {
                            this.play('dialog-warning');
                        }
                    }
                );
            } catch (e) {
                logger.warn(
                    'sound',
                    'AstalBattery not available, skipping battery alerts:',
                    e
                );
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    #connectUPower(): void {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try {
                const upower = AstalBattery.UPower.new();
                this.#upowerInstance = upower;

                // Device added/removed
                this.#upowerHandlerIds.push(
                    upower.connect('device-added', () =>
                        this.play('device-added')
                    )
                );
                this.#upowerHandlerIds.push(
                    upower.connect('device-removed', () =>
                        this.play('device-removed')
                    )
                );

                // Power plug/unplug — find the LINE_POWER device
                const linePower = upower
                    .get_devices()
                    .find(
                        (d: AstalBattery.Device) =>
                            d.get_device_type() ===
                            AstalBattery.Type.LINE_POWER
                    );
                if (linePower) {
                    this.#upowerHandlerIds.push(
                        linePower.connect('notify::online', () => {
                            if (linePower.online) {
                                this.play('power-plug');
                            } else {
                                this.play('power-unplug');
                            }
                        })
                    );
                }
            } catch (e) {
                logger.warn(
                    'sound',
                    'AstalBattery.UPower not available, skipping power/device sounds:',
                    e
                );
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Play a freedesktop.org sound theme event.
     * Silently fails if canberra-gtk-play is not available or the sound
     * theme is missing — no sound is a valid state.
     */
    play(soundId: string): void {
        if (!this.#enabled) return;

        // Check category enable flags
        const category = this.#categorize(soundId);
        if (category === 'notification' && !this.#notificationEnabled) return;
        if (category === 'capture' && !this.#captureEnabled) return;
        if (category === 'battery' && !this.#batteryEnabled) return;
        if (category === 'system' && !this.#systemEnabled) return;

        // Check DND
        if (this.#dnd.dnd) return;

        try {
            Process.exec(`canberra-gtk-play --id=${soundId}`);
        } catch (e) {
            // Silently ignore — no sound theme is a valid state
            logger.debug(
                'sound',
                `canberra-gtk-play --id=${soundId} failed:`,
                e
            );
        }
    }

    #categorize(soundId: string): SoundCategory {
        switch (soundId) {
            case 'message-new-instant':
                return 'notification';
            case 'dialog-warning':
                return 'battery';
            case 'screen-lock':
            case 'screen-unlock':
            case 'power-plug':
            case 'power-unplug':
            case 'device-added':
            case 'device-removed':
                return 'system';
            default:
                return 'capture';
        }
    }

    dispose(): void {
        for (const unsub of this.#busUnsubs) {
            unsub();
        }
        this.#busUnsubs = [];

        if (this.#shellStateHandlerId !== 0) {
            try {
                this.#shell.disconnect(this.#shellStateHandlerId);
            } catch { /* ignore */ }
            this.#shellStateHandlerId = 0;
        }

        if (this.#notifdHandlerId !== 0) {
            const notifd = getNotifdSafe();
            if (notifd) {
                try {
                    notifd.disconnect(this.#notifdHandlerId);
                } catch { /* ignore */ }
            }
            this.#notifdHandlerId = 0;
        }

        if (this.#batteryHandlerId !== 0) {
            try {
                AstalBattery.get_default().disconnect(
                    this.#batteryHandlerId
                );
            } catch { /* ignore */ }
            this.#batteryHandlerId = 0;
        }

        for (const id of this.#upowerHandlerIds) {
            if (this.#upowerInstance) {
                try {
                    this.#upowerInstance.disconnect(id);
                } catch { /* ignore */ }
            }
        }
        this.#upowerHandlerIds = [];
        this.#upowerInstance = null;

        this.#initialized = false;
    }
}