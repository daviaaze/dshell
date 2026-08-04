/**
 * Brightness service — wraps AstalBrightness (gi://AstalBrightness).
 *
 * AstalBrightness.Brightness exposes:
 *   - .screen → Device (interface, not a number)
 *   - .keyboard → Device (not `.kbd`!)
 *
 * Each Device has:
 *   - .brightness: number (0–1 percentage, writable)
 *   - .name: string
 *   - .get_max_brightness(): number (raw max)
 *   - .get_real_brightness(): number (raw value)
 *   - notify::brightness fires when the percentage changes
 *
 * The service also emits `brightness-changed(device)` on any change.
 */
import AstalBrightness from 'gi://AstalBrightness';
import logger from '@shade/core/logger';
import {Object, property, register} from 'gnim/gobject';
import {bus} from '../bus';
import OsdTimer from '../utils/osdTimer';

@register
export default class Brightness extends Object {
    private static instance: Brightness;

    static get_default() {
        if (!Brightness.instance) Brightness.instance = new Brightness();
        return Brightness.instance;
    }

    #screenDev: AstalBrightness.Device | null = null;
    #kbdDev: AstalBrightness.Device | null = null;
    #ready = false;
    #busSubscriptions: (() => void)[] = [];

    // ── OSD state (owned here so osd/bar/quicksettings share one source) ──

    #screenOsd = new OsdTimer(() => this.notify('screen-osd-visible'));
    #kbdOsd = new OsdTimer(() => this.notify('kbd-osd-visible'));

    /** True while the screen brightness OSD should be revealed. */
    @property
    get screenOsdVisible(): boolean {
        return this.#screenOsd.visible;
    }

    /** True while the keyboard brightness OSD should be revealed. */
    @property
    get kbdOsdVisible(): boolean {
        return this.#kbdOsd.visible;
    }

    @property
    get ready() {
        return this.#ready;
    }

    /** Screen brightness [0–1] */
    @property
    get screen(): number {
        return this.#screenDev?.brightness ?? 0;
    }

    set screen(value: number) {
        const dev = this.#screenDev;
        if (dev) dev.brightness = Math.max(0, Math.min(1, value));
    }

    /** Keyboard brightness [0–1] */
    @property
    get kbd(): number {
        return this.#kbdDev?.brightness ?? 0;
    }

    set kbd(value: number) {
        const dev = this.#kbdDev;
        if (dev) dev.brightness = Math.max(0, Math.min(1, value));
    }

    constructor() {
        super();

        try {
            const svc = AstalBrightness.Brightness.get_default();

            // Note: the GIR property is `keyboard`, NOT `kbd`
            const screenDev: AstalBrightness.Device | null = svc.screen;
            const kbdDev: AstalBrightness.Device | null = svc.keyboard;
            this.#screenDev = screenDev;
            this.#kbdDev = kbdDev;

            logger.info(
                'brightness',
                `Astal service initialized, screen=${screenDev?.brightness?.toFixed(3) ?? 'none'} (max=${screenDev?.get_max_brightness() ?? '?'}) kbd=${kbdDev?.brightness?.toFixed(3) ?? 'none'}`
            );

            // Forward property notifications from the Device objects.
            // Device.brightness fires notify::brightness when the percentage changes.
            screenDev?.connect('notify::brightness', () => {
                this.notify('screen');
                this.#screenOsd.trigger();
            });
            kbdDev?.connect('notify::brightness', () => {
                this.notify('kbd');
                this.#kbdOsd.trigger();
            });

            // Also listen to the service-level convenience signal
            svc.connect('brightness-changed', (_device: unknown) => {
                // Re-notify both — the device param tells us which one,
                // but re-notifying both is simpler and harmless.
                this.notify('screen');
                this.notify('kbd');
            });

            this.#ready = true;
            logger.info('brightness', 'AstalBrightness wrapper ready');

            // Force initial sync so bindings pick up the real value
            this.notify('screen');
            this.notify('kbd');

            // Listen for brightness set commands from widgets
            this.#busSubscriptions.push(
                bus.on('display:brightness:set', ({screen}) => {
                    if (screen !== undefined) this.screen = screen;
                })
            );
        } catch (e) {
            logger.error('brightness', 'failed to initialize AstalBrightness:', e);
        }
    }

    /**
     * Set brightness by property name (GObject style).
     * Used by consumers like: brightness.set({screen: 0.5})
     */
    set(props: Record<string, unknown>): void {
        if ('screen' in props) {
            this.screen = typeof props.screen === 'number' ? props.screen : 0;
        }
        if ('kbd' in props) {
            this.kbd = typeof props.kbd === 'number' ? props.kbd : 0;
        }
    }

    dispose(): void {
        this.#screenOsd.dispose();
        this.#kbdOsd.dispose();
        for (const unsub of this.#busSubscriptions) unsub();
        this.#busSubscriptions = [];
    }
}
