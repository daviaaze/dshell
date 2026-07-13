/**
 * Brightness service — wraps AstalBrightness (gi://AstalBrightness).
 *
 * Replaces manual brightnessctl/sysfs file monitoring.
 */
import AstalBrightness from 'gi://AstalBrightness';
import GObject, {getter, register, setter} from 'gnim/gobject';
import logger from '#/lib/core/logger';

@register({GTypeName: 'Brightness'})
export default class Brightness extends GObject.Object {
    static readonly instance: Brightness;

    static get_default() {
        if (!this.instance) this.instance = new Brightness();
        return this.instance;
    }

    #service: AstalBrightness.Brightness | null = null;
    #ready = false;

    @getter(Boolean)
    get ready() {
        return this.#ready;
    }

    @getter(Number)
    get kbd() {
        return this.#service?.kbd ?? 0;
    }

    @setter(Number)
    set kbd(value: number) {
        if (this.#service) {
            this.#service.kbd = Math.max(0, Math.min(1, value));
        }
    }

    @getter(Number)
    get screen() {
        return this.#service?.screen ?? 0;
    }

    @setter(Number)
    set screen(value: number) {
        if (this.#service) {
            this.#service.screen = Math.max(0, Math.min(1, value));
        }
    }

    constructor() {
        super();

        try {
            this.#service = AstalBrightness.get_default();

            // Forward property notifications from the Astal service
            this.#service.connect('notify::screen', () => {
                this.notify('screen');
            });
            this.#service.connect('notify::kbd', () => {
                this.notify('kbd');
            });

            this.#ready = true;
            logger.debug('hw', 'AstalBrightness initialized');
        } catch (e) {
            logger.error('hw', 'failed to initialize AstalBrightness:', e);
        }
    }

    /**
     * Set brightness by property name (GObject style).
     * Used by consumers like: brightness.set({screen: 0.5})
     */
    set(props: Record<string, unknown>): void {
        if ('screen' in props) {
            this.screen = (props.screen as number) ?? 0;
        }
        if ('kbd' in props) {
            this.kbd = (props.kbd as number) ?? 0;
        }
    }

    dispose(): void {
        // Cleanup handled by AstalBrightness
    }
}