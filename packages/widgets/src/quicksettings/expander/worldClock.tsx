import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import {For} from 'gnim';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {fmtOffset, cityName} from '@shade/core/time';
import Clock from '@shade/services/time/clock';

export const WorldClock = () => {
    const general = generalSettings();
    const time = Clock.get_default().time;

    const localTz = GLib.TimeZone.new_local();

    return (
        <Gtk.Box
            spacing={4}
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={['card', 'p-12']}
        >
            <Gtk.Label
                cssClasses={['title-3']}
                label="World Clock"
                halign={Gtk.Align.CENTER}
            />
            <For each={general.timezones}>
                {(tzId: string) => {
                    const tz = GLib.TimeZone.new(tzId);
                    const tzTime = time.as(t => t.to_timezone(tz));
                    return (
                        <Gtk.Box spacing={8} marginStart={8}>
                            <Gtk.Label
                                hexpand
                                halign={Gtk.Align.START}
                                cssClasses={['heading', 'title-4']}
                                label={cityName(tzId)}
                            />
                            <Gtk.Label
                                halign={Gtk.Align.END}
                                cssClasses={['numeric', 'title-4']}
                                label={tzTime.as(
                                    t => t?.format('%H:%M') ?? '--:--'
                                )}
                            />
                            <Gtk.Label
                                halign={Gtk.Align.END}
                                cssClasses={['caption', 'dim-label']}
                                label={fmtOffset(localTz, tz)}
                            />
                        </Gtk.Box>
                    );
                }}
            </For>
        </Gtk.Box>
    );
};
