export const MAX_COUNTDOWN_PRESET_MINUTES = 2147483647;

export function validateCountdownPreset(
    raw: string,
    current: readonly number[]
): {kind: 'empty' | 'not-integer' | 'out-of-range'} | {kind: 'duplicate' | 'valid'; minutes: number} {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return {kind: 'empty'};
    if (!/^[+-]?[0-9]+$/.test(trimmed)) return {kind: 'not-integer'};

    const minutes = Number(trimmed);
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > MAX_COUNTDOWN_PRESET_MINUTES) {
        return {kind: 'out-of-range'};
    }

    return {kind: current.includes(minutes) ? 'duplicate' : 'valid', minutes};
}
