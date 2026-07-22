/**
 * Brightness service — wraps AstalBrightness (gi://AstalBrightness).
 *
 * AstalBrightness.Brightness.screen and .kbd are DeviceProxy objects,
 * not plain numbers. Each DeviceProxy has:
 *   - .brightness: number (current raw value)
 *   - .max_brightness: number
 *   - notify::brightness fires on raw value changes
 */
import AstalBrightness from 'gi://AstalBrightness';
import GObject, {getter, register, setter} from 'gnim/gobject';
import logger from '#/lib/core/logger';

@register({GTypeName: 'Brightness'})
export default class Brightness extends GObject.Object {
    static instance: Brightness;

    static get_default() {
        if (!this.instance) this.instance = new Brightness();
        return this.instance;
    }

    #screenDev: AstalBrightness.DeviceProxy | null = null;
    #kbdDev: AstalBrightness.DeviceProxy | null = null;
    #ready = false;

    @getter(Boolean)
    get ready() {
        return this.#ready;
    }

    /** Normalized screen brightness [0–1] */
    @getter(Number)
    get screen(): number {
        const dev = this.#screenDev;
        if (!dev || dev.max_brightness === 0) return 0;
        return dev.brightness / dev.max_brightness;
    }

    @setter(Number)
    set screen(value: number) {
        const dev = this.#screenDev;
        if (!dev) return;
        const clamped = Math.max(0, Math.min(1, value));
        dev.brightness = Math.round(clamped * dev.max_brightness);
    }

    /** Normalized keyboard brightness [0–1] */
    @getter(Number)
    get kbd(): number {
        const dev = this.#kbdDev;
        if (!dev || dev.max_brightness === 0) return 0;
        return dev.brightness / dev.max_brightness;
    }

    @setter(Number)
    set kbd(value: number) {
        const dev = this.#kbdDev;
        if (!dev) return;
        const clamped = Math.max(0, Math.min(1, value));
        dev.brightness = Math.round(clamped * dev.max_brightness);
    }

    constructor() {
        super();

        try {
            const svc = AstalBrightness.Brightness.get_default();
            const screenDev = svc.screen as AstalBrightness.DeviceProxy | null;
            const kbdDev = svc.kbd as AstalBrightness.DeviceProxy | null;
            this.#screenDev = screenDev;
            this.#kbdDev = kbdDev;

            logger.info(
                'brightness',
                `Astal service initialized, screen=${screenDev?.brightness ?? '?'}/${screenDev?.max_brightness ?? '?'} kbd=${kbdDev?.brightness ?? '?'}/${kbdDev?.max_brightness ?? '?'}`
            );

            // DeviceProxy fires notify::brightness when the raw value changes
            screenDev?.connect('notify::brightness', () => {
                logger.info('brightness', `notify::brightness on screen, raw=${screenDev.brightness}/${screenDev.max_brightness}`);
                this.notify('screen');
            });
            kbdDev?.connect('notify::brightness', () => {
                logger.info('brightness', `notify::brightness on kbd, raw=${kbdDev.brightness}/${kbdDev.max_brightness}`);
                this.notify('kbd');
            });

            // Also forward service-level notify::screen/kbd (if the service emits them)
            svc.connect('notify::screen', () => {
                this.notify('screen');
            });
            svc.connect('notify::kbd', () => {
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
