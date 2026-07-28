import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import {Accessor, For, bind, computed} from 'gnim';
import Clock from '../../lib/services/time/clock';
import TimerService from '../../lib/services/time/timerService';
import {useSettings} from '../../lib/settings';
import {useStyle} from '../../style/useStyle';
import {fmtDuration, cityName, fmtOffset} from '../../lib/core/time';
import {TimerSection} from '../quicksettings/timer/TimerSection';

export default ({
    vertical,
    visible = true,
}: {
    vertical: Accessor<boolean>;
    visible?: boolean | Accessor<boolean>;
}) => {
    const timerActiveStyle = useStyle({
        color: 'var(--shade-primary)',
        'font-weight': 'bold',
    });
    const {general} = useSettings();
    const time = Clock.get_default().time;
    const localTz = GLib.TimeZone.new_local();
    const hour = time.as(t => t.format('%H')!);
    const minute = time.as(t => t.format('%M')!);

    const timer = TimerService.get_default();
    const timerRemaining = bind(timer, 'remaining');
    const timerActive = computed(() => timerRemaining() >= 0);
    const timerDisplay = computed(() => {
        const rem = timerRemaining();
        return rem < 0 ? '' : fmtDuration(rem);
    });

    return (
        <Gtk.MenuButton
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            visible={visible}
        >
            <Gtk.Popover slot="popover">
                <Gtk.Box spacing={12} orientation={Gtk.Orientation.VERTICAL}>
                    <Gtk.Calendar />
                    <Gtk.Separator />
                    <Gtk.Label label="World Clock" halign={Gtk.Align.CENTER} />
                    <For each={general.timezones}>
                        {(tzId: string) => {
                            const tz = GLib.TimeZone.new(tzId);
                            return (
                                <Gtk.Box spacing={8}>
                                    <Gtk.Label label={cityName(tzId)} hexpand halign={Gtk.Align.START} />
                                    <Gtk.Label label={tzId} halign={Gtk.Align.END} />
                                </Gtk.Box>
                            );
                        }}
                    </For>
                    <Gtk.Separator />
                    <Gtk.Label label="Timer" halign={Gtk.Align.CENTER} />
                    <Gtk.Box widthRequest={230} halign={Gtk.Align.FILL}>
                        <TimerSection />
                    </Gtk.Box>
                </Gtk.Box>
            </Gtk.Popover>
            <Gtk.Box
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
                spacing={4}
            >
                <Gtk.Box
                    visible={timerActive.as(a => !a)}
                    spacing={4}
                >
                    <Gtk.Label
                        label={hour}
                        cssClasses={['title-1', 'numeric']}
                    />
                    <Gtk.Label
                        label={minute}
                        cssClasses={['title-1', 'numeric']}
                    />
                </Gtk.Box>
                <Gtk.Label
                    visible={timerActive}
                    label={timerDisplay}
                    cssClasses={['title-1', 'numeric', timerActiveStyle.class]}
                    ref={timerActiveStyle.$}
                />
            </Gtk.Box>
        </Gtk.MenuButton>
    );
};
