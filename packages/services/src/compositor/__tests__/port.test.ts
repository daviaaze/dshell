import {describe, expect, it, run} from '../../__tests__/test-runner';
import {CompositorPort} from '../port';

describe('CompositorPort DPMS commands', () => {
    it.async('invokes the generated DPMS dispatcher rather than only constructing it', async () => {
        const evaluated: string[] = [];
        const port = new CompositorPort({
            async dispatch() {
                throw new Error('Unexpected dispatch transport');
            },
            async eval(source) {
                evaluated.push(source);
            },
        });
        await port.applyDpms(false, 'DP-1');
        await port.applyDpms(true);
        expect(evaluated).toEqual([
            'hl.dispatch(hl.dsp.dpms({action="off", monitor="DP-1"}))',
            'hl.dispatch(hl.dsp.dpms({action="on"}))',
        ]);
    });

    it.async('propagates compositor execution failures', async () => {
        const port = new CompositorPort({
            async dispatch() {
                throw new Error('compositor rejected command');
            },
        });
        let failure = '';
        try {
            await port.applyDpms(false);
        } catch (error) {
            failure = String(error);
        }
        expect(failure.includes('compositor rejected command')).toBe(true);
    });

    it.async('rejects unacknowledged eval replies even when the transport resolves', async () => {
        for (const reply of ['error: display command rejected', '']) {
            const port = new CompositorPort({
                async dispatch() {
                    return 'ok';
                },
                async eval() {
                    return reply;
                },
            });
            let rejected = false;
            try {
                await port.applyDpms(false);
            } catch {
                rejected = true;
            }
            expect(rejected).toBe(true);
        }
        const port = new CompositorPort({
            async dispatch() {
                return 'ok';
            },
            async eval() {
                return 'ok\n';
            },
        });
        await port.applyDpms(true);
    });

    it.async('rejects a failed binding reply before reporting success', async () => {
        const port = new CompositorPort({
            async dispatch() {
                return 'error: binding command rejected';
            },
        });
        let rejected = false;
        try {
            await port.applyBinds(
                [],
                [
                    {
                        id: 'test',
                        keys: 'SUPER + T',
                        title: 'Terminal',
                        category: 'Apps',
                        action: {type: 'launch-app', desktopId: 'kitty'},
                    },
                ]
            );
        } catch {
            rejected = true;
        }
        expect(rejected).toBe(true);
    });
});

await run();
