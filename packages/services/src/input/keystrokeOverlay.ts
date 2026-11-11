import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import type AstalHyprland from 'gi://AstalHyprland?version=0.1';
import {defineService} from '@shade/core/define';
import {generalSettings} from '@shade/core/settings/general.gschema';
import logger from '@shade/core/logger';
import ShellState from '@shade/services/state/shellState';
import {Object as GObject, property, register} from 'gnim/gobject';
import {CompositorPort} from '../compositor/port';
import {getHyprland} from '../hyprland';
import {
    appendVisibleKey,
    expireVisibleKeys,
    KeySequenceTracker,
    parseKeyInputEvent,
    type VisibleKey,
} from './keystrokeOverlayModel';

const MAX_VISIBLE_KEYS = 4;
const KEY_TTL_MS = 1_400;
const MODIFIER_LABELS: Record<string, string> = {
    Shift_L: 'Shift',
    Shift_R: 'Shift',
    Control_L: 'Ctrl',
    Control_R: 'Ctrl',
    Alt_L: 'Alt',
    Alt_R: 'Alt',
    Meta_L: 'Meta',
    Meta_R: 'Meta',
    Super_L: 'Super',
    Super_R: 'Super',
    Hyper_L: 'Hyper',
    Hyper_R: 'Hyper',
    ISO_Level3_Shift: 'AltGr',
};
const SPECIAL_KEY_LABELS: Record<string, string> = {
    BackSpace: 'Backspace',
    Delete: 'Delete',
    Down: '↓',
    End: 'End',
    Escape: 'Esc',
    Home: 'Home',
    Insert: 'Ins',
    Left: '←',
    Next: 'Page↓',
    Page_Down: 'Page↓',
    Page_Up: 'Page↑',
    Prior: 'Page↑',
    Return: 'Enter',
    Right: '→',
    Tab: 'Tab',
    Up: '↑',
    space: 'Space',
    KP_Enter: 'Enter',
};

@register
export default class KeystrokeOverlay extends GObject {
    private static instance: KeystrokeOverlay;

    static get_default(): KeystrokeOverlay {
        if (!KeystrokeOverlay.instance) KeystrokeOverlay.instance = new KeystrokeOverlay();
        return KeystrokeOverlay.instance;
    }

    #hyprland: AstalHyprland.Hyprland | null = null;
    #shellState: ShellState | null = null;
    #port = new CompositorPort();
    #tracker = new KeySequenceTracker();
    #keys: VisibleKey[] = [];
    #layoutName = '';
    #expirySource = 0;
    #enabled = false;
    #error = '';
    #hyprlandSignalIds: number[] = [];
    #shellStateSignalId = 0;
    #subscriptionSync: Promise<void> = Promise.resolve();

    @property
    get recentKeysJson(): string {
        return JSON.stringify(this.#keys.map((entry) => entry.label));
    }

    @property
    get enabled(): boolean {
        return this.#enabled;
    }

    @property
    get error(): string {
        return this.#error;
    }

    init(): void {
        const settings = generalSettings();
        this.#enabled = settings.keystrokeOverlay();
        this.#hyprland = getHyprland();
        this.#shellState = ShellState.get_default();

        if (this.#hyprland) {
            this.#hyprlandSignalIds = [
                this.#hyprland.connect('event', (_hypr, event, args) =>
                    this.#onHyprlandEvent(event, args)
                ),
                this.#hyprland.connect('keyboard-layout', (_hypr, _keyboard, layout) => {
                    this.#layoutName = layout;
                }),
            ];
            void this.#loadActiveLayout();
        }
        this.#shellStateSignalId = this.#shellState.connect('notify::screenlocked', () => {
            if (this.#shellState?.screenlocked) this.#clear();
            void this.#syncSubscription();
        });
        void this.#syncSubscription();
    }

    async setEnabled(enabled: boolean): Promise<void> {
        if (this.#enabled !== enabled) {
            this.#enabled = enabled;
            this.notify('enabled');
        }
        if (!enabled) this.#clear();
        await this.#syncSubscription();
    }

    dispose(): void {
        this.#clear();
        if (this.#hyprland) for (const id of this.#hyprlandSignalIds) this.#hyprland.disconnect(id);
        if (this.#shellState && this.#shellStateSignalId)
            this.#shellState.disconnect(this.#shellStateSignalId);
        this.#hyprlandSignalIds = [];
        this.#shellStateSignalId = 0;
        this.#enabled = false;
        void this.#syncSubscription();
    }

    async #loadActiveLayout(): Promise<void> {
        try {
            const devices = await this.#port.deviceSnapshot();
            if (!this.#layoutName)
                this.#layoutName =
                    devices.keyboards.find((keyboard) => keyboard.active_keymap)?.active_keymap ??
                    '';
        } catch (cause) {
            logger.warn('keystroke-overlay', 'could not read active keyboard layout:', cause);
        }
    }

    #onHyprlandEvent(event: string, args: string): void {
        if (event === 'configreloaded') {
            void this.#syncSubscription();
            return;
        }
        const input = parseKeyInputEvent(event, args);
        if (!input || !this.#enabled || this.#shellState?.screenlocked !== false) return;
        const chord = this.#tracker.handle(input, this.#keyLabel(input.keycode));
        if (!chord) return;
        this.#keys = appendVisibleKey(
            this.#keys,
            chord,
            this.#nowMs(),
            KEY_TTL_MS,
            MAX_VISIBLE_KEYS
        );
        this.notify('recent-keys-json');
        this.#scheduleExpiry();
    }

    #keyLabel(keycode: number): string {
        const display = Gdk.Display.get_default();
        if (!display) return `Key ${keycode}`;
        const [mapped, keys, keyvals] = display.map_keycode(keycode);
        const keyboard = display.get_default_seat()?.get_keyboard();
        const groups = keyboard?.get_layout_names() ?? [];
        const group = groups.indexOf(this.#layoutName);
        const keyIndex =
            mapped && group >= 0
                ? keys.findIndex((key) => key.group === group && key.level === 0)
                : -1;
        const fallbackIndex = mapped
            ? keys.findIndex((key) => key.group === 0 && key.level === 0)
            : -1;
        const keyval = keyvals[keyIndex >= 0 ? keyIndex : fallbackIndex];
        if (keyval === undefined) return `Key ${keycode}`;

        const rawName = Gdk.keyval_name(keyval);
        const modifier = rawName ? MODIFIER_LABELS[rawName] : undefined;
        if (modifier) return modifier;
        const upperKeyval = Gdk.keyval_to_upper(keyval);
        const unicode = Gdk.keyval_to_unicode(upperKeyval);
        if (unicode > 0) {
            const printable = String.fromCodePoint(unicode);
            return printable.trim() ? printable.toUpperCase() : 'Space';
        }
        return rawName
            ? (SPECIAL_KEY_LABELS[rawName] ?? rawName.replaceAll('_', ' '))
            : `Key ${keycode}`;
    }

    #nowMs(): number {
        return GLib.get_monotonic_time() / 1_000;
    }

    #scheduleExpiry(): void {
        if (this.#expirySource) GLib.Source.remove(this.#expirySource);
        if (!this.#keys.length) {
            this.#expirySource = 0;
            return;
        }
        const nextExpiry = Math.min(...this.#keys.map((key) => key.expiresAt));
        const delay = Math.max(1, Math.ceil(nextExpiry - this.#nowMs()));
        this.#expirySource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this.#expirySource = 0;
            this.#keys = expireVisibleKeys(this.#keys, this.#nowMs());
            this.notify('recent-keys-json');
            this.#scheduleExpiry();
            return GLib.SOURCE_REMOVE;
        });
    }

    #clear(): void {
        this.#tracker.clear();
        this.#keys = [];
        if (this.#expirySource) GLib.Source.remove(this.#expirySource);
        this.#expirySource = 0;
        this.notify('recent-keys-json');
    }

    async #syncSubscription(): Promise<void> {
        const sync = this.#subscriptionSync
            .catch(() => {})
            .then(async () => {
                const enabled = this.#enabled && !(this.#shellState?.screenlocked ?? true);
                if (!enabled) this.#clear();
                try {
                    await this.#port.setKeystrokeOverlay(enabled);
                    if (this.#error) {
                        this.#error = '';
                        this.notify('error');
                    }
                } catch (cause) {
                    this.#error = String(cause);
                    this.notify('error');
                    logger.error('keystroke-overlay', 'could not sync Hyprland key hook:', cause);
                }
            });
        this.#subscriptionSync = sync;
        await sync;
    }
}

defineService({
    name: 'KeystrokeOverlay',
    service: KeystrokeOverlay.get_default(),
    dependsOn: ['ShellState'],
});
