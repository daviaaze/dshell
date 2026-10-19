import Keybinds, {SHELL_ACTION_DESCRIPTIONS, type HyprBind} from '../input/keybinds';
import {describe, expect, it, run} from './test-runner';

const keybinds = new Keybinds();

const bind = (values: Partial<HyprBind> = {}): HyprBind => ({
    key: '',
    mod: '',
    dispatcher: 'exec',
    arg: '',
    locked: false,
    mouse: false,
    release: false,
    repeat: false,
    nonmodal: false,
    hasDescription: false,
    ...values,
});

describe('Keybinds.formatDescription', () => {
    it('uses recognized Shade action metadata for registered actions', () => {
        expect(keybinds.formatDescription(bind({description: 'shade-action:toggle-applauncher'}))).toBe(
            'Toggle app launcher'
        );
        expect(keybinds.formatDescription(bind({description: 'shade-action:display-next'}))).toBe(
            'Cycle display layouts'
        );
        expect(
            keybinds.formatDescription(bind({description: 'shade-action:record-window-address'}))
        ).toBe('Record selected window');
    });

    it('preserves authored descriptions verbatim ahead of dispatcher meaning', () => {
        expect(
            keybinds.formatDescription(
                bind({dispatcher: 'workspace', arg: '1', description: '<A&B> authored'})
            )
        ).toBe('<A&B> authored');
    });

    it('keeps unknown Shade metadata neutral and does not parse raw commands', () => {
        expect(
            keybinds.formatDescription(
                bind({description: 'shade-action:future-action', arg: 'shade-shell toggle launcher'})
            )
        ).toBe('Run command');
        expect(keybinds.formatDescription(bind({arg: 'shade-shell toggle launcher'}))).toBe(
            'Run command'
        );
        expect(
            keybinds.formatDescription(
                bind({dispatcher: 'workspace', arg: 'shade-shell toggle launcher'})
            )
        ).toBe('Switch workspace: shade-shell toggle launcher');
    });

    it('uses known compositor meaning or a neutral label for unknown dispatchers', () => {
        expect(keybinds.formatDescription(bind({dispatcher: 'workspace', arg: '2'}))).toBe(
            'Switch workspace: 2'
        );
        expect(keybinds.formatDescription(bind({dispatcher: 'unknown'}))).toBe('Custom shortcut');
    });
});

await run(import.meta.url);
