import Inhibit from '#/lib/services/power/inhibit';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {bind, computed} from 'gnim';
import type {QuickButton} from '#/widget/quicksettings/button-grid/quickButton';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';
import {LinkedBox} from '#/widget/common/linkedBox';

export default (): QuickButton => {
    const inhibit = Inhibit.get_default();
    const idle = bind(inhibit, 'idle');
    const remaining = bind(inhibit, 'remaining');

    const label = computed(() => {
        const _idle = idle();
        const rem = remaining();
        if (!_idle) return 'Auto Sleep';
        return rem ? `Keep Awake (${rem})` : 'Keep Awake';
    });

    const icon = computed(() =>
        idle() ? 'weather-clear-symbolic' : 'weather-clear-night-symbolic'
    );

    const cssClasses = computed(() =>
        idle() ? ['raised', 'suggested-action'] : ['raised']
    );

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <LinkedBox>
                <Gtk.Button onClicked={() => inhibit.setDuration(0)}>
                    <Adw.ButtonContent
                        iconName="weather-clear-symbolic"
                        label="Indefinitely"
                    />
                </Gtk.Button>
                <Gtk.Button onClicked={() => inhibit.setDuration(5)}>
                    <Adw.ButtonContent
                        iconName="preferences-system-time-symbolic"
                        label="5 minutes"
                    />
                </Gtk.Button>
                <Gtk.Button onClicked={() => inhibit.setDuration(15)}>
                    <Adw.ButtonContent
                        iconName="preferences-system-time-symbolic"
                        label="15 minutes"
                    />
                </Gtk.Button>
                <Gtk.Button onClicked={() => inhibit.setDuration(60)}>
                    <Adw.ButtonContent
                        iconName="preferences-system-time-symbolic"
                        label="1 hour"
                    />
                </Gtk.Button>
                <Gtk.Separator visible={bind(inhibit, 'idle')} />
                <Gtk.Button
                    visible={bind(inhibit, 'idle')}
                    onClicked={() => (inhibit.idle = false)}
                >
                    <Adw.ButtonContent
                        iconName="window-close-symbolic"
                        label="Turn Off"
                    />
                </Gtk.Button>
            </LinkedBox>
        </Gtk.Popover>
    ) as unknown as Gtk.Popover;

    return {
        widget: (
            <QuickToggleButton
                cssClasses={cssClasses}
                icon={icon}
                label={label}
                onClick={() => {
                    if (inhibit.idle) inhibit.idle = false;
                    else inhibit.setDuration(0);
                }}
                popover={popover}
            />
        ) as unknown as Gtk.Widget,
    };
};
