import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import {
    Accessor,
    createBinding,
    createComputed,
    createState,
    For,
    onCleanup,
} from 'gnim';
import {useSettings} from '#/lib/settings';
import {usePopoverCleanup} from '#/widget/common/popoverCleanup';
import {fmtOffset, cityName, fmtDuration} from '#/lib/core/time';
import TimerService from '#/widget/quicksettings/timer/TimerService';
import {TimerSection} from '#/widget/quicksettings/timer/TimerSection';

function updateCalendar(calendar: Gtk.Calendar) {
    const now = GLib.DateTime.new_now_local();
    calendar.year = now.get_year();
    calendar.month = now.get_month() - 1;
    calendar.day = now.get_day_of_month();
}

export default ({
    vertical,
    visible = true,
}: {
    vertical: Accessor<boolean>;
    visible?: boolean | Accessor<boolean>;
}) => {
    const {general} = useSettings();
    const [time, setTime] = createState(new GLib.DateTime());
    const clockTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        setTime(GLib.DateTime.new_now_local());
        return GLib.SOURCE_CONTINUE;
    });
    onCleanup(() => GLib.source_remove(clockTimeout));

    const day = time.as(t => t.get_day_of_month().toString());
    const month = time.as(t => t.format('%b')!);
    const hour = time.as(t => t.format('%H')!);
    const minute = time.as(t => t.format('%M')!);

    const localTz = GLib.TimeZone.new_local();
    let calendarRef: Gtk.Calendar | null = null;

    const timer = TimerService.get_default();
    const timerRemaining = createBinding(timer, 'remaining');
    const timerActive = createComputed(() => timerRemaining() >= 0);
    const timerDisplay = createComputed(() => {
        const rem = timerRemaining();
        return rem < 0 ? '' : fmtDuration(rem);
    });

    return (
        <Gtk.MenuButton
            direction={vertical.as(v =>
                v ? Gtk.ArrowType.RIGHT : Gtk.ArrowType.UP
            )}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            visible={visible}
            $={usePopoverCleanup}
            popover={
                (
                    <Gtk.Popover
                        valign={Gtk.Align.CENTER}
                        halign={Gtk.Align.CENTER}
                        cssClasses={[]}
                        hasArrow={false}
                        $={self =>
                            self.connect('show', () => {
                                if (calendarRef) updateCalendar(calendarRef);
                            })
                        }
                    >
                        <Gtk.Box
                            spacing={12}
                            orientation={Gtk.Orientation.VERTICAL}
                            cssClasses={['popover-padded-lg']}
                        >
                            <Gtk.Box
                                visible={timerActive}
                                halign={Gtk.Align.CENTER}
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
                            <Gtk.Calendar
                                $={self => {
                                    calendarRef = self;
                                    updateCalendar(self);
                                }}
                            />
                            <Gtk.Separator />
                            <Gtk.Box
                                spacing={8}
                                orientation={Gtk.Orientation.VERTICAL}
                            >
                                <Gtk.Label
                                    cssClasses={['title-3']}
                                    label="World Clock"
                                    halign={Gtk.Align.CENTER}
                                />
                                <For each={general.timezones}>
                                    {(tzId: string) => {
                                        const tz = GLib.TimeZone.new(tzId);
                                        const tzTime = time.as(t =>
                                            t.to_timezone(tz)
                                        );
                                        return (
                                            <Gtk.Box
                                                spacing={8}
                                                marginStart={8}
                                                marginEnd={8}
                                            >
                                                <Gtk.Label
                                                    hexpand
                                                    halign={Gtk.Align.START}
                                                    cssClasses={[
                                                        'heading',
                                                        'title-4',
                                                    ]}
                                                    label={cityName(tzId)}
                                                />
                                                <Gtk.Label
                                                    halign={Gtk.Align.END}
                                                    cssClasses={[
                                                        'numeric',
                                                        'title-4',
                                                    ]}
                                                    label={tzTime.as(
                                                        t =>
                                                            t.format('%H:%M') ??
                                                            '--:--'
                                                    )}
                                                />
                                                <Gtk.Label
                                                    halign={Gtk.Align.END}
                                                    cssClasses={[
                                                        'caption',
                                                        'dim-label',
                                                    ]}
                                                    label={fmtOffset(
                                                        localTz,
                                                        tz
                                                    )}
                                                />
                                            </Gtk.Box>
                                        );
                                    }}
                                </For>
                            </Gtk.Box>
                            <Gtk.Separator />
                            <Gtk.Label
                                cssClasses={['title-3']}
                                label="Timer"
                                halign={Gtk.Align.CENTER}
                            />
                            <Gtk.Box widthRequest={230} halign={Gtk.Align.FILL}>
                                <TimerSection />
                            </Gtk.Box>
                        </Gtk.Box>
                    </Gtk.Popover>
                ) as Gtk.Popover
            }
        >
            <Gtk.Box
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
                orientation={vertical.as(v =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
                spacing={vertical.as(v => (v ? 0 : 4))}
            >
                <Gtk.Box
                    orientation={vertical.as(v =>
                        v
                            ? Gtk.Orientation.VERTICAL
                            : Gtk.Orientation.HORIZONTAL
                    )}
                    spacing={vertical.as(v => (v ? 0 : 4))}
                >
                    <Gtk.Box
                        visible={timerActive.as(a => !a)}
                        orientation={vertical.as(v =>
                            v
                                ? Gtk.Orientation.VERTICAL
                                : Gtk.Orientation.HORIZONTAL
                        )}
                        spacing={vertical.as(v => (v ? 0 : 4))}
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
                        cssClasses={['title-1', 'numeric', 'timer-active']}
                    />
                </Gtk.Box>
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
        </Gtk.MenuButton>
    );
};
