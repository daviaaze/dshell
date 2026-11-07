import Keybinds, {type HyprBind} from '../input/keybinds';
import {describe, expect, it, run} from './test-runner';

const keybinds = new Keybinds();

const bind = (values: Partial<HyprBind> = {}): HyprBind => ({
    key: '',
    dispatcher: '',
    modmask: 0,
    arg: '',
    locked: false,
    mouse: false,
    release: false,
    repeat: false,
    nonmodal: false,
    has_description: false,
    ...values,
});

describe('Lua keybind metadata', () => {


    it('preserves authored descriptions verbatim ahead of dispatcher meaning', () => {
        expect(
            keybinds.formatDescription(
                bind({
                    dispatcher: 'HL.Dispatcher(show)',
                    arg: '6',
                    description: '<A&B> authored',
                })
            )
        ).toBe('<A&B> authored');
    });

    it('does not expose Lua registry tokens or command arguments as descriptions', () => {
        const token = 'opaque-registry-token-9876';
        for (const dispatcher of ['HL.Dispatcher(exec_cmd)', 'HL.Dispatcher(unknown)']) {
            const description = keybinds.formatDescription(bind({dispatcher, arg: token}));
            expect(description.includes(token)).toBe(false);
        }
    });

    it('formats the native modifier mask', () => {
        expect(
            keybinds.formatKeyCombo(bind({key: 'R', modmask: 64 | 4 | 8 | 1}))
        ).toBe('Super + Ctrl + Alt + Shift + R');
    });
});

await run(import.meta.url);
