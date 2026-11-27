import {quickSettingsContentHeight} from '../quicksettings/heightBudget';
import {SURFACE_EDGE_GAP} from './surface';

const CRITICAL_URGENCY = 2;

export const NOTIFICATION_TOAST_SPACING = 4;

export type NotificationVariant = 'popup' | 'list' | 'lockscreen';

interface NotificationAction {
    id: string;
    label: string;
}

export interface NotificationActionButton {
    id: string;
    label: string;
    suggested: boolean;
}

interface ToastIdentity {
    id: number;
    urgency: number;
}

export interface NotificationCenterHeightMetrics {
    monitorHeight: number;
    reservedTop: number;
    reservedBottom: number;
    headerHeight: number;
    surfaceInsets: number;
}

/** Share the panel budget; this center has no fixed error or footer rows. */
export function notificationCenterContentHeight(metrics: NotificationCenterHeightMetrics): number {
    return quickSettingsContentHeight({...metrics, errorHeight: 0, footerHeight: 0});
}

/** Safety ceiling only: GTK shares the bounded stack by natural size, not equal thirds. */
export function notificationToastCardHeight(monitorHeight: number): number {
    return Math.max(1, Math.floor(monitorHeight - SURFACE_EDGE_GAP * 2));
}

/** Always request the current content's natural size, never the window's previous allocation. */
export function notificationToastWindowHeight(monitorHeight: number, naturalHeight: number): number {
    const available = Math.max(1, Math.floor(monitorHeight - SURFACE_EDGE_GAP * 2));
    return Math.max(1, Math.min(available, Math.ceil(naturalHeight)));
}

/** Pango applies these line bounds after wrapping; never slice markup or URLs. */
export function notificationTextBounds(variant: NotificationVariant) {
    return {summaryLines: 2, bodyLines: variant === 'popup' ? 3 : -1};
}

/** Freedesktop urgency is 0 (low), 1 (normal), or 2 (critical). */
export function notificationUrgency(urgency: number) {
    const critical = urgency === CRITICAL_URGENCY;
    return {critical, autoDismiss: !critical};
}

export function hasDefaultAction(actions: readonly NotificationAction[]): boolean {
    return actions.some((action) => action.id === 'default');
}

export function actionButtons(actions: readonly NotificationAction[]): NotificationActionButton[] {
    const visible = actions.filter((action) => action.id !== 'default' && action.label.trim());
    return visible.map((action) => ({
        id: action.id,
        label: action.label.trim(),
        suggested: visible.length === 1,
    }));
}

/** Criticals first; new arrivals lead their band and same-id content updates stay put. */
export function upsertToast<T extends ToastIdentity>(
    stack: readonly T[],
    incoming: T,
    cap = 3
): T[] {
    const index = stack.findIndex((item) => item.id === incoming.id);
    const next = [...stack];
    if (index >= 0) next[index] = incoming;
    else next.unshift(incoming);
    // Stable sorting preserves arrival/update order within each urgency band.
    next.sort((left, right) =>
        Number(right.urgency === CRITICAL_URGENCY) - Number(left.urgency === CRITICAL_URGENCY)
    );
    return next.slice(0, cap);
}

/** History is literal text, including text that happened to contain valid markup. */
export function escapeNotificationMarkup(text: string): string {
    return text.replace(/[&<>"']/g, (character) => {
        switch (character) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            default: return '&apos;';
        }
    });
}

/** One clock for both popup expiry and progress; callers supply monotonic milliseconds. */
export class ToastCountdown {
    readonly #duration: number;
    #remaining: number;
    #deadline: number | null;

    constructor(durationMs: number, now: number) {
        this.#duration = durationMs;
        this.#remaining = durationMs;
        this.#deadline = now + durationMs;
    }

    remaining(now: number): number {
        return this.#deadline === null ? this.#remaining : Math.max(0, this.#deadline - now);
    }

    fraction(now: number): number {
        return this.#duration > 0 ? Math.min(1, this.remaining(now) / this.#duration) : 0;
    }

    pause(now: number): void {
        if (this.#deadline === null) return;
        this.#remaining = this.remaining(now);
        this.#deadline = null;
    }

    resume(now: number): void {
        if (this.#deadline !== null) return;
        this.#deadline = now + this.#remaining;
    }
}
