import Clock from '@shade/services/time/clock';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

export const GreeterClock = () => {
    const clock = Clock.get_default();
    const wallTime = clock.wallTime;

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
            <Gtk.Label
                cssClasses={['title-1', 'numeric']}
                label={wallTime.as((t: unknown) => (t as GLib.DateTime)?.format('%R') ?? '')}
                halign={Gtk.Align.CENTER}
            />
            <Gtk.Label
                cssClasses={['title-3']}
                label={wallTime.as((t: unknown) => (t as GLib.DateTime)?.format('%A, %x') ?? '')}
                halign={Gtk.Align.CENTER}
            />
        </Gtk.Box>
    );
};
