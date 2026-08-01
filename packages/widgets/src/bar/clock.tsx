import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {Accessor, For, bind, computed} from 'gnim';
import Clock from '@shade/services/time/clock';
import TimerService from '@shade/services/time/timerService';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {fmtDuration, cityName, fmtOffset} from '@shade/core/time';
import {TimerSection} from '../quicksettings/timer/TimerSection';

/** One world-clock row: city name, tz id, time, and offset vs local. */
function WorldClockRow({
    tzId,
    time,
    localTz,
}: {
    tzId: string;
    time: Accessor<GLib.DateTime>;
    localTz: GLib.TimeZone;
}) {
    const tz = GLib.TimeZone.new_identifier(tzId);

    if (!tz) return null;

    const tzTime = time.as(t => t.to_timezone(tz));

    return (
        <Gtk.Box spacing={8}>
            <Gtk.Label label={cityName(tzId)} hexpand halign={Gtk.Align.START} />
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                hexpand
                halign={Gtk.Align.END}
            >
                <Gtk.Label label={tzId} />
                <Gtk.Box>
                    <Gtk.Label
                        cssClasses={['numeric', 'title-4']}
                        label={tzTime.as(t => t?.format('%H:%M') ?? '--:--')}
                    />
                    <Gtk.Label
                        cssClasses={['caption', 'dim-label']}
                        label={fmtOffset(localTz, tz)}
                    />
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Box>
    );
}

/** Popover contents: calendar, world clocks, and timer section. */
function ClockPopover() {
    const general = generalSettings();
    const time = Clock.get_default().time;
    const localTz = GLib.TimeZone.new_local();

    return (
        <Gtk.Box spacing={12} orientation={Gtk.Orientation.VERTICAL}>
            <Gtk.Calendar />
            <Gtk.Separator />
            <Gtk.Label label="World Clock" halign={Gtk.Align.CENTER} />
            <For each={general.timezones}>
                {(tzId: string) => (
                    <WorldClockRow tzId={tzId} time={time} localTz={localTz} />
                )}
            </For>
            <Gtk.Separator />
            <Gtk.Label label="Timer" halign={Gtk.Align.CENTER} />
            <Gtk.Box widthRequest={230} halign={Gtk.Align.FILL}>
                <TimerSection />
            </Gtk.Box>
        </Gtk.Box>
    );
}

/** Button face: hour/minute + day/month, or the running timer. */
function ClockLabel({
    hour,
    minute,
    day,
    month,
    timerActive,
    timerDisplay,
}: {
    hour: Accessor<string>;
    minute: Accessor<string>;
    day: Accessor<string>;
    month: Accessor<string>;
    timerActive: Accessor<boolean>;
    timerDisplay: Accessor<string>;
}) {
    return (
        <Gtk.Box
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.CENTER}
            spacing={4}
        >
            <Gtk.Box visible={timerActive.as(a => !a)} spacing={4}>
                <Gtk.Label label={hour} cssClasses={['title-1', 'numeric']} />
                <Gtk.Label label={minute} cssClasses={['title-1', 'numeric']} />
                <Gtk.Box
                    visible={timerActive.as(a => !a)}
                    orientation={Gtk.Orientation.VERTICAL}
                    halign={Gtk.Align.CENTER}
                    valign={Gtk.Align.CENTER}
                >
                    <Gtk.Label cssClasses={['caption-heading']} label={day} />
                    <Gtk.Label cssClasses={['caption']} label={month} />
                </Gtk.Box>
            </Gtk.Box>
            <Gtk.Label
                visible={timerActive}
                label={timerDisplay}
                cssClasses={['title-1', 'numeric', 'accent']}
            />
        </Gtk.Box>
    );
}

export default ({
    visible = true,
}: {
    vertical: Accessor<boolean>;
    visible?: boolean | Accessor<boolean>;
}) => {
    const time = Clock.get_default().time;
    const hour = time.as(t => t.format('%H')!);
    const minute = time.as(t => t.format('%M')!);
    const day = time.as(t => t.format('%d')!);
    const month = time.as(t => t.format('%B')!);

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
                <ClockPopover />
            </Gtk.Popover>
            <ClockLabel
                hour={hour}
                minute={minute}
                day={day}
                month={month}
                timerActive={timerActive}
                timerDisplay={timerDisplay}
            />
        </Gtk.MenuButton>
    );
};
