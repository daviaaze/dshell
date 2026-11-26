import {describe, expect, it, run} from '../../../../packages/services/src/__tests__/test-runner';
import {dispatchCommandLine} from '../commandLine';

function commandLine(isRemote: boolean, args: string[]) {
    return {isRemote, get_arguments: () => args};
}

describe('dispatchCommandLine', () => {
    it('returns the remote request status without bootstrapping another UI', () => {
        let booted = false;
        const status = dispatchCommandLine(
            commandLine(true, ['shade-shell', 'unknown']),
            () => {
                booted = true;
            },
            () => 2
        );
        expect(booted).toBe(false);
        expect(status).toBe(2);
    });

    it('boots before serving the first local request and preserves its status', () => {
        const order: string[] = [];
        const status = dispatchCommandLine(
            commandLine(false, ['shade-shell', 'toggle', 'settings']),
            () => {
                order.push('boot');
            },
            () => {
                order.push('request');
                return 1;
            }
        );
        expect(order).toEqual(['boot', 'request']);
        expect(status).toBe(1);
    });

    it('starts the UI without dispatching an empty startup request', () => {
        let boots = 0;
        let requests = 0;
        const status = dispatchCommandLine(
            commandLine(false, ['shade-shell']),
            () => {
                boots++;
            },
            () => {
                requests++;
                return 2;
            }
        );
        expect(boots).toBe(1);
        expect(requests).toBe(0);
        expect(status).toBe(0);
    });
});

await run(import.meta.url);
