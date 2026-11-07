import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {Process} from '@shade/core/process';

function getOption(key: string, fallback: string): string {
    try {
        const output = Process.exec(`hyprctl getoption ${key}`);
        const match = output.match(/(?:int|float|string):\s*(\S+)/);
        return match ? match[1]! : fallback;
    } catch {
        return fallback;
    }
}

function setOption(key: string, value: string | number | boolean) {
    Process.execAsyncv(
        ['hyprctl', 'eval', `hl.config({[${JSON.stringify(key.replaceAll(':', '.'))}]=${JSON.stringify(value)}})`],
        true
    ).catch(() => {});
}

export default () => (
    <>
        <Adw.PreferencesGroup
            title="Ponteiro e mouse"
            description="Sensibilidade, aceleração, rolagem e mão principal."
        >
            <Adw.ActionRow title="Sensibilidade do ponteiro" subtitle="Velocidade do ponteiro (−1 a 1).">
                <Gtk.Scale
                    orientation={Gtk.Orientation.HORIZONTAL}
                    adjustment={new Gtk.Adjustment({
                        value: parseFloat(getOption('input:sensitivity', '0')),
                        lower: -1,
                        upper: 1,
                        stepIncrement: 0.1,
                    })}
                    widthRequest={200}
                    onValueChanged={(scale) => setOption('input:sensitivity', scale.get_value())}
                />
            </Adw.ActionRow>
            <Adw.ComboRow
                title="Perfil de aceleração"
                subtitle="Opções disponibilizadas pelo compositor."
                model={new Gtk.StringList({strings: ['Linear', 'Adaptável']})}
                selected={getOption('input:accel_profile', 'flat') === 'adaptive' ? 1 : 0}
                onNotifySelected={(row) => {
                    setOption('input:accel_profile', row.selected === 0 ? 'flat' : 'adaptive');
                }}
            />
            <Adw.SwitchRow
                title="Rolagem natural do mouse"
                subtitle="A direção da rolagem acompanha o movimento dos dedos."
                active={getOption('input:natural_scroll', 'false') === 'true'}
                onNotifyActive={(row) => setOption('input:natural_scroll', row.active)}
            />
            <Adw.SwitchRow
                title="Mouse para canhotos"
                subtitle="Troca as funções dos botões principal e secundário."
                active={getOption('input:left_handed', 'false') === 'true'}
                onNotifyActive={(row) => setOption('input:left_handed', row.active)}
            />
        </Adw.PreferencesGroup>
        <Adw.PreferencesGroup
            title="Touchpad"
            description="Toque, arraste e rolagem."
        >
            <Adw.SwitchRow
                title="Tocar para clicar"
                subtitle="Toque no touchpad para clicar."
                active={getOption('input:touchpad:tap-to-click', 'true') === 'true'}
                onNotifyActive={(row) => setOption('input:touchpad:tap-to-click', row.active)}
            />
            <Adw.SwitchRow
                title="Tocar e arrastar"
                subtitle="Toque e mantenha para arrastar."
                active={getOption('input:touchpad:tap-and-drag', 'true') === 'true'}
                onNotifyActive={(row) => setOption('input:touchpad:tap-and-drag', row.active)}
            />
            <Adw.SwitchRow
                title="Desativar enquanto digita"
                subtitle="Desativa o touchpad durante a digitação."
                active={getOption('input:touchpad:disable_while_typing', 'true') === 'true'}
                onNotifyActive={(row) => setOption('input:touchpad:disable_while_typing', row.active)}
            />
            <Adw.SwitchRow
                title="Rolagem natural do touchpad"
                subtitle="A direção da rolagem acompanha o movimento dos dedos."
                active={getOption('input:touchpad:natural_scroll', 'false') === 'true'}
                onNotifyActive={(row) => setOption('input:touchpad:natural_scroll', row.active)}
            />
            <Adw.ActionRow title="Velocidade de rolagem" subtitle="Sensibilidade da rolagem do touchpad.">
                <Gtk.Scale
                    orientation={Gtk.Orientation.HORIZONTAL}
                    adjustment={new Gtk.Adjustment({
                        value: parseFloat(getOption('input:touchpad:scroll_factor', '1.0')),
                        lower: 0.1,
                        upper: 5,
                        stepIncrement: 0.1,
                    })}
                    widthRequest={200}
                    onValueChanged={(scale) => setOption('input:touchpad:scroll_factor', scale.get_value())}
                />
            </Adw.ActionRow>
        </Adw.PreferencesGroup>
    </>
);
