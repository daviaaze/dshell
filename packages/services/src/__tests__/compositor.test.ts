import {describe, expect, it, run} from './test-runner';
import {CompositorPort} from '../compositor/port';
import type {BindSpec} from '@shade/compositor-model';

const bind = (id: string, keys: string): BindSpec => ({
    id,
    keys,
    title: id,
    category: 'Test',
    action: {type: 'command', command: 'true'},
});

describe('CompositorPort binding updates', () => {
    it('removes the prior chord before applying a remapped binding', async () => {
        const calls: string[] = [];
        const port = new CompositorPort({
            async dispatch(source) {
                calls.push(source);
            },
        });
        await port.applyBinds([bind('test', 'SUPER + A')], [bind('test', 'SUPER + B')]);
        expect(calls).toEqual([
            'hl.unbind("SUPER + A")',
            'hl.bind("SUPER + B", hl.dsp.exec_cmd("true"), {description = "test"})',
        ]);
    });

    it('does not dispatch when the effective binding is unchanged', async () => {
        const calls: string[] = [];
        const port = new CompositorPort({
            async dispatch(source) {
                calls.push(source);
            },
        });
        await port.applyBinds([bind('test', 'SUPER + A')], [bind('test', 'SUPER + A')]);
        expect(calls.length).toBe(0);
    });
});

run();
