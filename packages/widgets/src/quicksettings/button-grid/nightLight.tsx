import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import NightLight, {TEMP_MAX, TEMP_MIN} from '@shade/services/display/nightLight';
import {bind, effect} from 'gnim';
import {QuickControlButton} from '../../common/quickControlButton';
import type {QuickDetailButton} from './quickButton';

export default (onOpen: (self: Gtk.Button) => void): QuickDetailButton => {
    const nightLight = NightLight.get_default();

    const detail = (
        <Gtk.Box
            cssClasses={['toolbar', 'linked', 'vertical']}
            marginTop={8}
            marginBottom={8}
            marginStart={8}
            marginEnd={8}
            orientation={Gtk.Orientation.VERTICAL}
            spacing={8}
        >
            <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
                <Gtk.Label label="Temperatura" />
                {(() => {
                    const $temperature = bind(nightLight, 'temperature');
                    const adjustment = new Gtk.Adjustment({
                        lower: TEMP_MIN,
                        upper: TEMP_MAX,
                        stepIncrement: 100,
                        value: $temperature(),
                    });
                    effect(() => {
                        adjustment.value = $temperature();
                    });
                    return (
                        <Gtk.Scale
                            widthRequest={150}
                            digits={0}
                            roundDigits={0}
                            adjustment={adjustment}
                            onValueChanged={(self) =>
                                bus.emit(
                                    'display:nightlight:temperature',
                                    Math.round(self.get_value())
                                )
                            }
                        />
                    );
                })()}
                <Gtk.Label
                    widthRequest={56}
                    xalign={1}
                    label={bind(nightLight, 'temperature').as((t) => `${t}K`)}
                    cssClasses={['caption']}
                />
            </Gtk.Box>
            <Gtk.Separator />
            <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
                <Gtk.Label label="Agendamento automático" hexpand />
                <Gtk.Switch
                    active={bind(nightLight, 'autoSchedule')}
                    onNotifyActive={(self) => {
                        if (self.active !== nightLight.autoSchedule)
                            bus.emit('display:nightlight:schedule', self.active);
                    }}
                />
            </Gtk.Box>
        </Gtk.Box>
    );

    return {
        detail,
        widget: (
            <QuickControlButton
                intent="toggle"
                active={bind(nightLight, 'enabled')}
                icon={bind(nightLight, 'enabled').as((enabled) =>
                    enabled ? 'night-light-symbolic' : 'night-light-disabled-symbolic'
                )}
                domain="Luz noturna"
                value={bind(nightLight, 'enabled').as((enabled) =>
                    enabled ? 'Ativada' : 'Desativada'
                )}
                actionLabel={bind(nightLight, 'enabled').as((enabled) =>
                    enabled ? 'Desativar luz noturna' : 'Ativar luz noturna'
                )}
                onClick={() => bus.emit('display:nightlight:enabled', !nightLight.enabled)}
                detail={{label: 'Opções de luz noturna', onOpen}}
            />
        ),
    };
};
