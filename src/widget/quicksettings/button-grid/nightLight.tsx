import Gtk from 'gi://Gtk?version=4.0';
import {bind, effect} from 'gnim';
import type {QuickButton} from '#/widget/quicksettings/button-grid/quickButton';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';
import NightLight, {
    TEMP_MIN,
    TEMP_MAX,
} from '#/lib/services/display/nightLight';

export default (): QuickButton => {
    const nightLight = NightLight.get_default();

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <Gtk.Box
                cssClasses={['toolbar', 'linked', 'popover-padded']}
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
                                onValueChanged={self =>
                                    (nightLight.temperature = Math.round(
                                        self.get_value()
                                    ))
                                }
                            />
                        );
                    })()}
                    <Gtk.Label
                        widthRequest={56}
                        xalign={1}
                        label={bind(nightLight, 'temperature').as(t => `${t}K`)}
                        cssClasses={['caption']}
                    />
                </Gtk.Box>
                <Gtk.Separator />
                <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
                    <Gtk.Label label="Auto Schedule" hexpand />
                    <Gtk.Switch
                        active={bind(nightLight, 'autoSchedule')}
                        onNotifyActive={self =>
                            (nightLight.autoSchedule = self.active)
                        }
                    />
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Popover>
    );

    return {
        widget: (
            <QuickToggleButton
                cssClasses={bind(nightLight, 'enabled').as(e =>
                    e ? ['raised', 'suggested-action'] : ['raised']
                )}
                icon={bind(nightLight, 'enabled').as(e =>
                    e ? 'night-light-symbolic' : 'night-light-disabled-symbolic'
                )}
                label="Night Light"
                onClick={() => (nightLight.enabled = !nightLight.enabled)}
                popover={popover}
            />
        ),
    };
};
