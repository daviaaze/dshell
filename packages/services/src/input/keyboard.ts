import GLib from 'gi://GLib?version=2.0';
import {Object, register, signal, property} from 'gnim/gobject';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';

interface KeyboardDevice {
    name: string;
    active_keymap: string;
}

interface HyprlandDevices {
    keyboards: KeyboardDevice[];
}

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

    static get_default() {
        if (!this.instance) this.instance = new KeyboardLayout();
        return this.instance;
    }

    #layout = '';
    #available = false;
    #timer: number | null = null;

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
            const out = await Process.execAsync('hyprctl devices -j');
            const data: HyprlandDevices = JSON.parse(out);
            const keyboards = data.keyboards || [];
            const mainKb = keyboards.find(
                k =>
                    k.name !== 'wlroots-keyboard-pointer' &&
                    k.name !== 'wayland' &&
                    k.name !== ''
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

    cycle() {
        Process.execAsync('hyprctl devices -j')
            .then(out => {
                const data: HyprlandDevices = JSON.parse(out);
                const keyboards = data.keyboards || [];
                const mainKb = keyboards.find(
                    k =>
                        k.name !== 'wlroots-keyboard-pointer' &&
                        k.name !== 'wayland' &&
                        k.name !== ''
                );
                if (mainKb) {
                    return Process.execAsync(
                        `hyprctl switchxkblayout "${mainKb.name}" next`
                    );
                }
                return undefined;
            })
            .then(() => this.#update())
            .catch(e => logger.error('keyboard', 'cycle failed:', e));
    }

    constructor() {
        super();
        this.#update();
        this.#timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this.#update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    dispose() {
        if (this.#timer !== null) {
            GLib.source_remove(this.#timer);
            this.#timer = null;
        }
    }
}
