import type {WindowState} from './types';

/** Matches shade-window-thumbnail's argument limit; excess entries stay selectable. */
export const WINDOW_CAPTURE_LIMIT = 128;

export interface WindowCaptureRequest {
    stableId: string;
    path: string;
    indices: number[];
}

/** One request per eligible ID, with every picker entry that shares its pixels. */
export function planWindowCaptureBatch(
    windows: readonly Pick<WindowState, 'hyprStableId'>[],
    directory: string
): WindowCaptureRequest[] {
    const requests: WindowCaptureRequest[] = [];
    const byId = new Map<string, WindowCaptureRequest>();
    windows.forEach((state, index) => {
        const stableId = state.hyprStableId;
        if (stableId === null) return;
        const existing = byId.get(stableId);
        if (existing) {
            existing.indices.push(index);
            return;
        }
        if (requests.length === WINDOW_CAPTURE_LIMIT) return;
        const request: WindowCaptureRequest = {
            stableId,
            // Opaque protocol IDs never become filenames or paths.
            path: `${directory}/window-${requests.length}.png`,
            indices: [index],
        };
        requests.push(request);
        byId.set(stableId, request);
    });
    return requests;
}
