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
import {Object, register, property, Int} from 'gnim/gobject';
import logger from '#/lib/core/logger';

@register({GTypeName: 'Brightness'})
export default class Brightness extends Object {
    static instance: Brightness;

    static get_default() {
        if (!this.instance) this.instance = new Brightness();
        return this.instance;
    }

    #screenDev: AstalBrightness.Device | null = null;
    #kbdDev: AstalBrightness.Device | null = null;
    #ready = false;

    @property(Boolean)
    get ready() {
        return this.#ready;
    }

    /** Screen brightness [0–1] */
    @property(Int)
    get screen(): number {
        return this.#screenDev?.brightness ?? 0;
    }

    
    set screen(value: number) {
        const dev = this.#screenDev;
        if (dev) dev.brightness = Math.max(0, Math.min(1, value));
    }

    /** Keyboard brightness [0–1] */
    @property(Int)
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
                logger.info('brightness', `notify::brightness on screen → ${screenDev.brightness.toFixed(3)}`);
                this.notify('screen');
            });
            kbdDev?.connect('notify::brightness', () => {
                logger.info('brightness', `notify::brightness on keyboard → ${kbdDev.brightness.toFixed(3)}`);
                this.notify('kbd');
            });

            // Also listen to the service-level convenience signal
            svc.connect('brightness-changed', (_device: unknown) => {
                logger.info('brightness', 'brightness-changed signal');
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
        // Cleanup handled by AstalBrightness
    }
}
