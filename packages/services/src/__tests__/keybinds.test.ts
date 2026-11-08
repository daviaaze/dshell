import Keybinds, {
    categorizeBinds,
    type HyprBind,
    presentBindTitle,
    presentCategory,
    presentKeyName,
} from '../input/keybinds';
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
    it('groups binds by translated presentation category without changing them', () => {
        const appBind = bind({dispatcher: 'HL.Dispatcher(exec_cmd)', arg: 'terminal'});
        const windowBind = bind({dispatcher: 'HL.Dispatcher(close)', arg: 'active'});
        const unknownBind = bind({dispatcher: 'HL.Dispatcher(custom_dispatcher)'});
        const input = [appBind, windowBind, unknownBind];
        const categories = categorizeBinds(input);

        expect(categories.map(({category}) => category)).toEqual([
            'Abrir aplicativos',
            'Controles de janela',
            'Outros',
        ]);
        expect(categories[0].binds[0]).toBe(appBind);
        expect(categories[1].binds[0]).toBe(windowBind);
        expect(categories[2].binds[0]).toBe(unknownBind);
        expect(input[0]).toBe(appBind);
        expect(input.length).toBe(3);
    });

    it('distinguishes known shell actions from generic and unknown commands', () => {
        expect(
            keybinds.formatDescription(
                bind({
                    dispatcher: 'HL.Dispatcher(exec_cmd)',
                    description: 'shade-action:toggle-quicksettings',
                })
            )
        ).toBe('Mostrar ou ocultar configurações rápidas');
        expect(keybinds.formatDescription(bind({dispatcher: 'HL.Dispatcher(exec_cmd)'}))).toBe(
            'Executar comando'
        );
        expect(
            keybinds.formatDescription(bind({dispatcher: 'HL.Dispatcher(custom_dispatcher)'}))
        ).toBe('Atalho personalizado');
    });

    it('translates known categories and preserves unknown labels', () => {
        expect(presentCategory('Launch Applications')).toBe('Abrir aplicativos');
        expect(presentCategory('Other')).toBe('Outros');
        expect(presentCategory('Layout')).toBe('Layout');
        expect(presentCategory('Custom category')).toBe('Custom category');
    });

    it('translates known titles and preserves unknown descriptions', () => {
        expect(presentBindTitle('Choose display mode')).toBe('Escolher modo de exibição');
        expect(presentBindTitle('Toggle recording')).toBe('Iniciar ou parar gravação');
        expect(presentBindTitle('Move')).toBe('Mover janela');
        expect(presentBindTitle('Custom authored title')).toBe('Custom authored title');
    });

    it('keeps exec titles generic instead of inferring a program from arguments', () => {
        const execBind = bind({
            dispatcher: 'HL.Dispatcher(exec_cmd)',
            arg: '/usr/bin/firefox --new-window',
        });
        expect(keybinds.formatTitle(execBind)).toBe('Executar comando');
    });

    it('presents raw mouse keys in Portuguese', () => {
        expect(presentKeyName('mouse_up')).toBe('Roda do mouse ↑');
        expect(presentKeyName('mouse_down')).toBe('Roda do mouse ↓');
        expect(presentKeyName('mouse:272')).toBe('Botão esquerdo do mouse');
        expect(presentKeyName('R')).toBe('R');
    });

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

    it('does not expose Lua registry tokens or command arguments in titles', () => {
        const token = 'opaque-registry-token-9876';
        for (const dispatcher of ['HL.Dispatcher(exec_cmd)', 'HL.Dispatcher(unknown)']) {
            const bindWithToken = bind({dispatcher, arg: token});
            const title = keybinds.formatTitle(bindWithToken);
            expect(title.includes(token)).toBe(false);
            expect(title).toBe(
                dispatcher.includes('exec_cmd') ? 'Executar comando' : 'Atalho personalizado'
            );
        }
    });

    it('formats the native modifier mask', () => {
        expect(keybinds.formatKeyCombo(bind({key: 'R', modmask: 64 | 4 | 8 | 1}))).toBe(
            'Super + Ctrl + Alt + Shift + R'
        );
    });
});

await run(import.meta.url);
