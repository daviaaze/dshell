import type AstalHyprland from 'gi://AstalHyprland?version=0.1';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {CompositorPort, type HyprlandKeyboard} from '../compositor/port';
import {getHyprland} from '@shade/services/hyprland';
import {Object, property, register, signal} from 'gnim/gobject';

type KeyboardDevice = HyprlandKeyboard;

function parseLayoutName(fullName: string): string {
    const match = fullName.match(/\(([A-Za-z]+)\)/);
    if (match) return match[1]!.toUpperCase();
    const code = fullName.split(/[\s_]/)[0]!.toUpperCase();
    if (code.length <= 3) return code;
    return fullName.substring(0, 3).toUpperCase();
}

@register
export default class KeyboardLayout extends Object {
    private static instance: KeyboardLayout;

    static get_default(): KeyboardLayout {
        if (!KeyboardLayout.instance) KeyboardLayout.instance = KeyboardLayout.create();
        return KeyboardLayout.instance;
    }

    static create(): KeyboardLayout {
        const instance = new KeyboardLayout();
        instance.#init();
        return instance;
    }

    #layout = '';
    #available = false;
    #timer: number | null = null;
    #hyprland: AstalHyprland.Hyprland | null = null;
    #layoutHandlerId = 0;
    #compositor = new CompositorPort();

    @property
    get layout() {
        return this.#layout;
    }

    @property
    get available() {
        return this.#available;
    }

    @signal
    layoutChanged() {}

    #inFlight = false;

    /** Async poll — sync exec blocked the main loop every 2s. */
    async #update(): Promise<void> {
        if (this.#inFlight) return; // skip overlapping polls
        this.#inFlight = true;
        try {
            const data = await this.#compositor.deviceSnapshot();
            const keyboards: KeyboardDevice[] = data.keyboards;
            const mainKb = keyboards.find(
                (k) =>
                    k.name !== 'wlroots-keyboard-pointer' && k.name !== 'wayland' && k.name !== ''
            );
            if (mainKb) {
                const layout = parseLayoutName(mainKb.active_keymap);
                if (layout !== this.#layout) {
                    this.#layout = layout;
                    this.notify('layout');
                    this.layoutChanged();
                }
                this.#available = keyboards.length > 0;
                this.notify('available');
            } else {
                this.#available = false;
                this.notify('available');
            }
        } catch (e) {
            logger.error('keyboard', '#update failed:', e);
            this.#available = false;
            this.notify('available');
        } finally {
            this.#inFlight = false;
        }
    }

    #onLayoutChanged(_hypr: AstalHyprland.Hyprland, _keyboard: string, layout: string): void {
        const parsed = parseLayoutName(layout);
        if (parsed !== this.#layout) {
            this.#layout = parsed;
            this.notify('layout');
            this.layoutChanged();
        }
    }

    #init(): void {
        // Prefer Hyprland IPC events — zero polling, instant updates.
        const hypr = getHyprland();
        if (hypr) {
            this.#hyprland = hypr;
            this.#layoutHandlerId = hypr.connect('keyboard-layout', (_h, keyboard, layout) => {
                this.#onLayoutChanged(_h, keyboard, layout);
            });
            // Initial read
            this.#update();
            return;
        }

        // Fallback: no Hyprland adapter — slow poll (30s instead of 2s).
        logger.warn('keyboard', 'Hyprland IPC unavailable — falling back to 30s poll');
        this.#update();
        this.#timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30_000, () => {
            this.#update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async cycle(): Promise<void> {
        try {
            const data = await this.#compositor.deviceSnapshot();
            const mainKb = data.keyboards.find(
                (keyboard) =>
                    keyboard.name !== 'wlroots-keyboard-pointer' &&
                    keyboard.name !== 'wayland' &&
                    keyboard.name !== ''
            );
            if (mainKb) await this.#compositor.switchKeyboardLayout(mainKb.name);
            await this.#update();
        } catch (error) {
            logger.error('keyboard', 'cycle failed:', error);
        }
    }

    dispose() {
        if (this.#timer !== null) {
            GLib.source_remove(this.#timer);
            this.#timer = null;
        }
        if (this.#hyprland && this.#layoutHandlerId) {
            try {
                this.#hyprland.disconnect(this.#layoutHandlerId);
            } catch {
                /* ignore */
            }
            this.#layoutHandlerId = 0;
            this.#hyprland = null;
        }
    }
}
