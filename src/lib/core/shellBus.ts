import GObject from 'gi://GObject?version=2.0';
import {Object, register} from 'gnim/gobject';
import logger from '#/lib/core/logger';

/**
 * Well-known shell bus event names.
 *
 * Add new events here to keep the bus typed and discoverable.
 */
export const ShellEvents = {
    /** Toggle the quick settings panel. */
    QUICK_SETTINGS_TOGGLE: 'quick-settings-toggle',
    /** Toggle the applauncher. */
    APPLAUNCHER_TOGGLE: 'applauncher-toggle',
    /** Request an OSD popup for a given type (volume, brightness, etc.). */
    OSD_SHOW: 'osd-show',
    /** Screenshot captured or recording started/stopped. */
    SCREENSHOT_CHANGED: 'screenshot-changed',
    /** Night Light state changed. */
    NIGHT_LIGHT_CHANGED: 'night-light-changed',
    /** DND state changed. */
    DND_CHANGED: 'dnd-changed',
    /** A global notification should be shown. */
    NOTIFY: 'notify',
} as const;

export type ShellEventName = (typeof ShellEvents)[keyof typeof ShellEvents];

/**
 * Payload types for each shell event.
 * `void` means no payload; a tuple means [payload] is emitted.
 */
export interface ShellEventPayloads {
    [ShellEvents.QUICK_SETTINGS_TOGGLE]: void;
    [ShellEvents.APPLAUNCHER_TOGGLE]: void;
    [ShellEvents.OSD_SHOW]: {type: string; value?: number};
    [ShellEvents.SCREENSHOT_CHANGED]: {recording: boolean};
    [ShellEvents.NIGHT_LIGHT_CHANGED]: {enabled: boolean};
    [ShellEvents.DND_CHANGED]: {enabled: boolean};
    [ShellEvents.NOTIFY]: {title: string; body: string; urgency?: string};
}

/**
 * ShellBus — typed event bus for shell-wide cross-widget communication.
 *
 * Widgets and services emit events and listen without importing each other.
 *
 * Usage:
 *   // Emit
 *   ShellBus.get_default().fire(ShellEvents.OSD_SHOW, {type: 'volume'});
 *
 *   // Listen
 *   const h = ShellBus.get_default().on(ShellEvents.OSD_SHOW, p => ...);
 *   ShellBus.get_default().off(h);
 */
@register({GTypeName: 'ShellBus'})
export default class ShellBus extends Object {
    static instance: ShellBus;

    static get_default(): ShellBus {
        if (!this.instance) this.instance = new ShellBus();
        return this.instance;
    }

    /**
     * Listen for an event.
     * Returns a GObject handler ID (for off()).
     */
    on<E extends ShellEventName>(
        event: E,
        fn: ShellEventPayloads[E] extends void
            ? () => void
            : (payload: ShellEventPayloads[E]) => void
    ): number {
        return GObject.signal_connect(this, event, (_source: GObject.Object, ...args: unknown[]) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-arguments
            (fn as (...args: unknown[]) => void)(...args);
        });
    }

    /** Remove a listener by handler ID. */
    off(handle: number) {
        try {
            this.disconnect(handle);
        } catch (e) {
            logger.warn(
                'shellBus',
                `failed to disconnect handler ${handle}:`,
                e
            );
        }
    }

    /**
     * Emit an event with optional payload.
     * Uses GObject.emit() under the hood.
     */
    fire<E extends ShellEventName>(
        event: E,
        ...args: ShellEventPayloads[E] extends void
            ? []
            : [ShellEventPayloads[E]]
    ) {
        GObject.signal_emit_by_name(this, event, ...args);
        logger.debug(
            'shellBus',
            `fired: ${event}` +
                (args.length > 0 ? ` ${JSON.stringify(args[0])}` : '')
        );
    }
}
