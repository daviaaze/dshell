import Pango from 'gi://Pango?version=1.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {cityName, fmtDuration, fmtOffset} from '@shade/core/time';
import Clock from '@shade/services/time/clock';
import TimerService from '@shade/services/time/timerService';
import {type Accessor, bind, computed, effect, For} from 'gnim';
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

    const tzTime = time.as((t) => t.to_timezone(tz));

    return (
        <Gtk.Box spacing={8}>
            <Gtk.Label label={cityName(tzId)} hexpand halign={Gtk.Align.START} />
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand halign={Gtk.Align.END}>
                <Gtk.Label label={tzId} />
                <Gtk.Box>
                    <Gtk.Label
                        cssClasses={['numeric', 'title-4']}
                        label={tzTime.as((t) => t?.format('%H:%M') ?? '--:--')}
                    />
                    <Gtk.Label cssClasses={['caption', 'dimmed']} label={fmtOffset(localTz, tz)} />
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Box>
    );
}

/** Popover contents: calendar, world clocks, and timer section. */
function ClockPopover() {
    const general = generalSettings();
    const clock = Clock.get_default();
    // World clocks show HH:MM too — the 1-minute wall tick is sufficient.
    const time = clock.wallTime;
    const localTz = GLib.TimeZone.new_local();

    return (
        <Gtk.Box spacing={12} orientation={Gtk.Orientation.VERTICAL}>
            <Gtk.Calendar />
            <Gtk.Separator />
            <Gtk.Label label="World Clock" halign={Gtk.Align.CENTER} />
            <For each={general.timezones}>
                {(tzId: string) => <WorldClockRow tzId={tzId} time={time} localTz={localTz} />}
            </For>
            <Gtk.Separator />
            <Gtk.Label label="Timer" halign={Gtk.Align.CENTER} />
            <Gtk.Box widthRequest={230} halign={Gtk.Align.FILL}>
                <TimerSection />
            </Gtk.Box>
        </Gtk.Box>
    );
}

/** Button face: time/date follows the bar orientation, or shows the running timer. */
function ClockLabel({
    hour,
    minute,
    day,
    month,
    timerActive,
    timerDisplay,
    vertical,
}: {
    hour: Accessor<string>;
    minute: Accessor<string>;
    day: Accessor<string>;
    month: Accessor<string>;
    timerActive: Accessor<boolean>;
    timerDisplay: Accessor<string>;
    vertical: Accessor<boolean>;
}) {
    return (
        <Gtk.Box halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} spacing={4}>
            <Gtk.Box
                visible={timerActive.as((a) => !a)}
                spacing={4}
                orientation={vertical.as((v) =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
            >
                <Gtk.Label label={hour} cssClasses={['title-1', 'numeric']} />
                <Gtk.Label label={minute} cssClasses={['title-1', 'numeric']} />
                <Gtk.Box
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
                maxWidthChars={vertical.as((v) => (v ? 2 : 12))}
                ellipsize={Pango.EllipsizeMode.END}
                tooltipText={timerDisplay}
            />
        </Gtk.Box>
    );
}


export default ({
    vertical,
    visible = true,
}: {
    vertical: Accessor<boolean>;
    visible?: boolean | Accessor<boolean>;
}) => {
    const clock = Clock.get_default();
    // Wall clock shows hours/minutes only — bind to the 1-minute tick.
    const wallTime = clock.wallTime;
    const hour = wallTime.as((t) => t.format('%H')!);
    const minute = wallTime.as((t) => t.format('%M')!);
    const day = wallTime.as((t) => t.format('%d')!);
    const month = wallTime.as((t) => t.format(vertical() ? '%b' : '%B')!);
    const fullDate = wallTime.as((t) => t.format('%A, %B %e, %Y') ?? '');

    const timer = TimerService.get_default();
    const timerRemaining = bind(timer, 'remaining');
    const timerActive = computed(() => timerRemaining() >= 0);
    const timerDisplay = computed(() => {
        const rem = timerRemaining();
        return rem < 0 ? '' : fmtDuration(rem);
    });
    const buttonTooltip = computed(() => (timerActive() ? timerDisplay() : fullDate()));

    return (
        <Gtk.MenuButton
            cssClasses={vertical.as((v) => (v ? ['bar-vertical-content-button'] : []))}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            visible={visible}
            tooltipText={buttonTooltip}
            ref={(self) => {
                effect(() => {
                    const accessibleName = timerActive()
                        ? `Timer: ${timerDisplay()}`
                        : `Time ${hour()}:${minute()}, ${fullDate()}`;
                    self.update_property(
                        [Gtk.AccessibleProperty.LABEL, Gtk.AccessibleProperty.DESCRIPTION],
                        [
                            new GObject.Value(GObject.TYPE_STRING, accessibleName),
                            new GObject.Value(
                                GObject.TYPE_STRING,
                                'Opens the calendar, world clocks, and timer controls.'
                            ),
                        ]
                    );
                });
            }}>
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
                vertical={vertical}
            />
        </Gtk.MenuButton>
    );
};
