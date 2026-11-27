import {
    actionButtons,
    escapeNotificationMarkup,
    hasDefaultAction,
    notificationCenterContentHeight,
    notificationTextBounds,
    notificationUrgency,
    notificationToastCardHeight,
    notificationToastWindowHeight,
    ToastCountdown,
    upsertToast,
} from '../common/notificationModel';
import {describe, expect, it, run} from './test-runner';

const toast = (id: number, urgency = 1) => ({id, urgency});

describe('notification text bounds', () => {
    it('limits toast summaries and bodies without truncating the source text', () => {
        expect(notificationTextBounds('popup')).toEqual({summaryLines: 2, bodyLines: 3});
    });

    it('keeps the center body complete while bounding its summary', () => {
        expect(notificationTextBounds('list')).toEqual({summaryLines: 2, bodyLines: -1});
    });

    it('does not silently truncate allowed lock-screen content', () => {
        expect(notificationTextBounds('lockscreen')).toEqual({summaryLines: 2, bodyLines: -1});
    });
});

describe('notification urgency', () => {
    it('pins critical notifications and disables their automatic dismissal', () => {
        expect(notificationUrgency(2)).toEqual({critical: true, autoDismiss: false});
    });

    it('keeps low and normal notifications on the ordinary dismissal path', () => {
        expect(notificationUrgency(0)).toEqual({critical: false, autoDismiss: true});
        expect(notificationUrgency(1)).toEqual({critical: false, autoDismiss: true});
    });
});

describe('notification action buttons', () => {
    it('excludes the default action and blank labels without leaving empty buttons', () => {
        const actions = [
            {id: 'default', label: 'Abrir'},
            {id: 'empty', label: ''},
            {id: 'spaces', label: ' \t\n '},
            {id: 'reply', label: ' Responder '},
        ];
        expect(actionButtons(actions)).toEqual([
            {id: 'reply', label: 'Responder', suggested: true},
        ]);
        expect(hasDefaultAction(actions)).toBe(true);
        expect(actions[3].label).toBe(' Responder ');
    });

    it('does not suggest the first action when several actions are available', () => {
        expect(actionButtons([
            {id: 'reply', label: 'Responder'},
            {id: 'archive', label: 'Arquivar'},
        ])).toEqual([
            {id: 'reply', label: 'Responder', suggested: false},
            {id: 'archive', label: 'Arquivar', suggested: false},
        ]);
    });

    it('has no action row when every advertised action is hidden', () => {
        expect(actionButtons([
            {id: 'default', label: 'Abrir'},
            {id: 'blank', label: '  '},
        ])).toEqual([]);
    });

    it('does not advertise a clickable default action for ordinary buttons', () => {
        expect(hasDefaultAction([{id: 'reply', label: 'Responder'}])).toBe(false);
        expect(hasDefaultAction([{id: 'default', label: ''}])).toBe(true);
    });
});

describe('notification toast order', () => {
    it('inserts the newest toast at the top without mutating the existing stack', () => {
        const old = [toast(2), toast(1)];
        expect(upsertToast(old, toast(3)).map((n) => n.id)).toEqual([3, 2, 1]);
        expect(old.map((n) => n.id)).toEqual([2, 1]);
    });

    it('pins a critical above the three later normal arrivals from the 800px VM case', () => {
        let stack = [toast(1, 2)];
        for (const id of [2, 3, 4]) stack = upsertToast(stack, toast(id));
        expect(stack.map((n) => n.id)).toEqual([1, 4, 3]);
    });

    it('updates a normal toast in its priority band without duplicating or promoting its id', () => {
        const updated = {...toast(2), summary: 'Transferência concluída'};
        const result = upsertToast([toast(1, 2), toast(3), toast(2)], updated);
        expect(result.map((n) => n.id)).toEqual([1, 3, 2]);
        expect(result[2]).toBe(updated);
    });

    it('orders new criticals before older criticals and all normal toasts', () => {
        const stack = upsertToast([toast(1, 2), toast(2)], toast(3, 2));
        expect(stack.map((n) => n.id)).toEqual([3, 1, 2]);
        expect(upsertToast(stack, toast(4)).map((n) => n.id)).toEqual([3, 1, 4]);
    });

    it('does not move an older critical when its content is updated', () => {
        const updated = {...toast(2, 2), summary: 'Ainda crítico'};
        const result = upsertToast([toast(3, 2), toast(2, 2), toast(1)], updated);
        expect(result.map((n) => n.id)).toEqual([3, 2, 1]);
        expect(result[1]).toBe(updated);
    });

    it('does not let ordinary chatter displace three critical toasts', () => {
        const critical = [toast(3, 2), toast(2, 2), toast(1, 2)];
        expect(upsertToast(critical, toast(4)).map((n) => n.id)).toEqual([3, 2, 1]);
    });

    it('retains the newest critical toasts when critical notifications alone exceed the cap', () => {
        expect(upsertToast([toast(3, 2), toast(2, 2), toast(1, 2)], toast(4, 2))
            .map((n) => n.id)).toEqual([4, 3, 2]);
    });

    it('moves an urgency escalation into the critical band ahead of normal toasts', () => {
        expect(upsertToast([toast(3), toast(2), toast(1)], toast(1, 2))
            .map((n) => n.id)).toEqual([1, 3, 2]);
    });
});

describe('notification center height budget', () => {
    const metrics = {
        monitorHeight: 800,
        reservedTop: 0,
        reservedBottom: 0,
        headerHeight: 34,
        surfaceInsets: 12 * 2 + 12,
    };

    it('includes the measured 34px header in the 792px layer at 1280×800', () => {
        const viewport = notificationCenterContentHeight(metrics);
        expect(viewport).toBe(722);
        expect(viewport + metrics.headerHeight + metrics.surfaceInsets).toBe(792);
    });

    it('subtracts logical top and bottom reservations exactly once', () => {
        const viewport = notificationCenterContentHeight({
            ...metrics,
            reservedTop: 48,
            reservedBottom: 24,
        });
        expect(viewport).toBe(650);
        expect(viewport + metrics.headerHeight + metrics.surfaceInsets).toBe(800 - 8 - 48 - 24);
    });

    it('reduces the viewport when themed or wrapped header content grows', () => {
        expect(notificationCenterContentHeight({...metrics, headerHeight: 54})).toBe(702);
        expect(notificationCenterContentHeight({...metrics, surfaceInsets: 38})).toBe(720);
    });

    it('rounds down fractional logical pixels without exceeding the window budget', () => {
        expect(notificationCenterContentHeight({...metrics, monitorHeight: 800.75})).toBe(722);
    });

    it('recomputes the open center budget for a 900px to 800px geometry change', () => {
        const allocations = [900, 800].map((monitorHeight) => {
            const viewport = notificationCenterContentHeight({...metrics, monitorHeight});
            return {viewport, window: viewport + metrics.headerHeight + metrics.surfaceInsets};
        });
        expect(allocations).toEqual([
            {viewport: 822, window: 892},
            {viewport: 722, window: 792},
        ]);
    });
});

describe('toast live geometry and natural sizing', () => {
    it('lets each card request natural height while the aggregate output budget changes', () => {
        expect([800, 900, 800].map((height) => notificationToastCardHeight(height)))
            .toEqual([792, 892, 792]);
    });

    it('requests the full actionable stack instead of retaining the previous 355px window', () => {
        expect([355, 485, 355].map((natural) => notificationToastWindowHeight(800, natural)))
            .toEqual([355, 485, 355]);
    });

    it('does not compress a fitting 485px stack during mapped output resizes', () => {
        expect([800, 900, 800].map((height) => notificationToastWindowHeight(height, 485)))
            .toEqual([485, 485, 485]);
    });

    it('fits the wrapped-action update into spare height from the shorter cards', () => {
        const heights = [225, 225, 257 + 16]
            .map((natural) => Math.min(natural, notificationToastCardHeight(800)));
        expect(heights).toEqual([225, 225, 273]);
        const stack = heights.reduce((sum, height) => sum + height, 0) + 4 * 2;
        expect(stack).toBe(731);
        expect(notificationToastWindowHeight(800, stack)).toBe(731);
    });

    it('limits genuinely overflowing stacks to the current logical monitor minus edge gaps', () => {
        expect([800, 900, 800].map((height) => notificationToastWindowHeight(height, 1200)))
            .toEqual([792, 892, 792]);
    });

    it('keeps the capped three-card stack within fractional logical monitor bounds', () => {
        expect(notificationToastWindowHeight(800.75, 1200)).toBe(792);
        const oversized = notificationToastCardHeight(800.75) * 3 + 4 * 2;
        expect(notificationToastWindowHeight(800.75, oversized)).toBe(792);
    });
});

describe('notification history markup', () => {
    it('escapes markup, ampersands and quotes instead of interpreting notification text', () => {
        expect(escapeNotificationMarkup('<b>literal</b> & "texto" \'sim\''))
            .toBe('&lt;b&gt;literal&lt;/b&gt; &amp; &quot;texto&quot; &apos;sim&apos;');
    });

    it('keeps plain Unicode and URL text intact except for markup metacharacters', () => {
        expect(escapeNotificationMarkup('Bateria 10% • ação 🔋 https://a.test/?x=1&y=2'))
            .toBe('Bateria 10% • ação 🔋 https://a.test/?x=1&amp;y=2');
        expect(escapeNotificationMarkup('')).toBe('');
    });
});

describe('toast countdown', () => {
    it('pauses the displayed progress and remaining dismissal time while hovered', () => {
        const countdown = new ToastCountdown(5000, 1000);
        countdown.pause(2000);
        expect(countdown.remaining(9000)).toBe(4000);
        expect(countdown.fraction(9000)).toBe(0.8);
        countdown.resume(9000);
        expect(countdown.remaining(10000)).toBe(3000);
        expect(countdown.fraction(10000)).toBe(0.6);
    });

    it('does not reset the lifetime on repeated pointer events or progress reads', () => {
        const countdown = new ToastCountdown(5000, 0);
        countdown.resume(1000);
        countdown.pause(2000);
        countdown.pause(3000);
        expect(countdown.remaining(10000)).toBe(3000);
        countdown.resume(10000);
        countdown.resume(11000);
        expect(countdown.remaining(12000)).toBe(1000);
    });

    it('clamps expired countdowns at zero', () => {
        const countdown = new ToastCountdown(1000, 0);
        expect(countdown.remaining(2000)).toBe(0);
        expect(countdown.fraction(2000)).toBe(0);
    });
});

run(import.meta.url);
