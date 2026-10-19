import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import NightLight, {TEMP_MAX, TEMP_MIN} from '@shade/services/display/nightLight';
import {bind, effect} from 'gnim';
import {QuickControlButton} from '../../common/quickControlButton';
import type {QuickButton} from './quickButton';

export default (): QuickButton => {
    const nightLight = NightLight.get_default();

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <Gtk.Box
                cssClasses={['toolbar', 'linked']}
                marginTop={8}
                marginBottom={8}
                marginStart={8}
                marginEnd={8}
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
            >
                <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
                    <Gtk.Label label="Temperature" />
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
                    <Gtk.Label label="Auto Schedule" hexpand />
                    <Gtk.Switch
                        active={bind(nightLight, 'autoSchedule')}
                        onNotifyActive={(self) =>
                            bus.emit('display:nightlight:schedule', self.active)
                        }
                    />
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Popover>
    );

    return {
        widget: (
            <QuickControlButton
                intent="toggle"
                active={bind(nightLight, 'enabled')}
                icon={bind(nightLight, 'enabled').as((enabled) =>
                    enabled ? 'night-light-symbolic' : 'night-light-disabled-symbolic'
                )}
                domain="Night Light"
                value={bind(nightLight, 'enabled').as((enabled) => enabled ? 'On' : 'Off')}
                actionLabel={bind(nightLight, 'enabled').as((enabled) =>
                    enabled ? 'Turn Night Light off' : 'Turn Night Light on'
                )}
                onClick={() => bus.emit('display:nightlight:enabled', !nightLight.enabled)}
                menu={{label: 'Night Light options', popover}}
            />
        ),
    };
};
