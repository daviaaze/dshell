import type {PreviewState} from './types';

export function resolvePreviewFrame<T>(
    current: T | null,
    next: T | null
): {
    texture: T | null;
    state: PreviewState;
} {
    if (next !== null) return {texture: next, state: 'available'};
    if (current !== null) return {texture: current, state: 'unavailable'};
    return {texture: null, state: 'unavailable'};
}
