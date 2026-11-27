/**
 * Replaying a just-made selection for the same requester (pure, no GI).
 *
 * Electron 43 apps (Backspace, Element, Slack…) open a portal session in
 * `desktopCapturer.getSources()` and the capture they start from that source
 * opens a second one, so XDPH launches the picker twice in a row for a single
 * share. The second run answers with the choice the user made half a second
 * ago, so they are asked once and the stream is the source they picked.
 */

export type SourceKind = 'screen' | 'window';

export interface RememberedSelection {
    /** D-Bus unique name of the requesting process, from the session handle. */
    requester: string;
    kind: SourceKind;
    id: string;
    allowToken: boolean;
    /** Epoch milliseconds. */
    at: number;
}

/** The second session follows the first by well under a second; a deliberate new share does not. */
export const REUSE_WINDOW_MS = 5000;

export function parseSelection(text: string | null): RememberedSelection | null {
    if (!text) return null;
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof value !== 'object' || value === null) return null;
    const {requester, kind, id, allowToken, at} = value as Record<string, unknown>;
    if (typeof requester !== 'string' || requester === '') return null;
    if (kind !== 'screen' && kind !== 'window') return null;
    if (typeof id !== 'string' || id === '') return null;
    if (typeof allowToken !== 'boolean' || typeof at !== 'number') return null;
    return {requester, kind, id, allowToken, at};
}

/**
 * The selection to replay, or null when the picker must ask.
 *
 * It must come from the same requester, be recent, and still name something
 * that exists: a window closed in between, or an unplugged output, falls back
 * to the dialog instead of sharing nothing.
 */
export function selectionToReplay(
    remembered: RememberedSelection | null,
    requester: string | null,
    now: number,
    exists: (kind: SourceKind, id: string) => boolean
): RememberedSelection | null {
    if (!remembered || requester === null) return null;
    if (remembered.requester !== requester) return null;
    const age = now - remembered.at;
    if (age < 0 || age > REUSE_WINDOW_MS) return null;
    return exists(remembered.kind, remembered.id) ? remembered : null;
}

/** The line XDPH reads from the picker's stdout; shared by the dialog and replay paths. */
export function selectionLine(kind: SourceKind, id: string, allowToken: boolean): string {
    return `[SELECTION]${allowToken ? 'r' : ''}/${kind}:${id}`;
}
