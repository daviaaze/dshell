export type VisibleKey = {label: string; expiresAt: number};

const MIN_XKB_KEYCODE = 8;
const MAX_XKB_KEYCODE = 255;

export type KeyInputEvent = {keycode: number; state: 0 | 1};

/** Accept only press/release events emitted by Shade's Hyprland custom channel. */
export function parseKeyInputEvent(event: string, args: string): KeyInputEvent | null {
    if (event !== 'custom') return null;
    const match = /^shade-key:(\d+),([01])$/.exec(args);
    if (!match) return null;
    const keycode = Number(match[1]);
    if (!Number.isInteger(keycode) || keycode < MIN_XKB_KEYCODE || keycode > MAX_XKB_KEYCODE)
        return null;
    return {keycode, state: Number(match[2]) as 0 | 1};
}

export function expireVisibleKeys(keys: readonly VisibleKey[], now: number): VisibleKey[] {
    return keys.filter((key) => key.expiresAt > now);
}

export function appendVisibleKey(
    keys: readonly VisibleKey[],
    label: string,
    now: number,
    ttlMs = 1_400,
    limit = 4
): VisibleKey[] {
    if (!label || limit < 1 || ttlMs < 1) return expireVisibleKeys(keys, now);
    return [...expireVisibleKeys(keys, now), {label, expiresAt: now + ttlMs}].slice(-limit);
}

const MODIFIERS = new Set(['Shift', 'Ctrl', 'Alt', 'Super', 'Meta', 'Hyper', 'AltGr']);
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Super', 'Meta', 'Hyper', 'AltGr', 'Shift'];

export class KeySequenceTracker {
    #held = new Map<number, string>();

    handle(event: KeyInputEvent, label: string): string | null {
        if (event.state === 0) {
            this.#held.delete(event.keycode);
            return null;
        }
        if (this.#held.has(event.keycode)) return null;
        this.#held.set(event.keycode, label);
        const modifiers = [
            ...new Set([...this.#held.values()].filter((key) => MODIFIERS.has(key))),
        ];
        if (MODIFIERS.has(label)) return this.#orderedModifiers(modifiers).join('+');
        return [...this.#orderedModifiers(modifiers), label].join('+');
    }

    clear(): void {
        this.#held.clear();
    }

    #orderedModifiers(modifiers: string[]): string[] {
        return MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
    }
}
