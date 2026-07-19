import {useSettings} from '#/lib/settings';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import {createState, For} from 'gnim';
import {usePopoverCleanup} from '#/widget/common/popoverCleanup';

export default () => {
    const {general} = useSettings();

    const [PRESET_TIMEZONES] = createState([
        'UTC',
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Sao_Paulo',
        'Europe/London',
        'Europe/Paris',
        'Europe/Berlin',
        'Europe/Moscow',
        'Asia/Dubai',
        'Asia/Kolkata',
        'Asia/Shanghai',
        'Asia/Tokyo',
        'Asia/Singapore',
        'Australia/Sydney',
        'Pacific/Auckland',
    ]);

    const TZ_POPOVER_MAX_HEIGHT = 300;

    return (
        <Adw.PreferencesGroup title="Clock" description="World clock timezones">
            <Adw.ActionRow
                title="Timezones"
                subtitle={general.timezones.as(tzs => tzs.join(', '))}
            >
                <Gtk.MenuButton $type="suffix" $={usePopoverCleanup}>
                    <Gtk.Button
                        cssClasses={['circular']}
                        iconName="list-add-symbolic"
                    />
                    <Gtk.Popover>
                        <Gtk.ScrolledWindow
                            maxContentHeight={TZ_POPOVER_MAX_HEIGHT}
                            vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
                        >
                            <Gtk.Box
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={4}
                                cssClasses={['linked']}
                            >
                                <For each={PRESET_TIMEZONES}>
                                    {(tz: string) => (
                                        <Gtk.Button
                                            label={tz.replaceAll('_', ' ')}
                                            onClicked={() => {
                                                const current =
                                                    general.timezones();
                                                if (!current.includes(tz)) {
                                                    general.setTimezones([
                                                        ...current,
                                                        tz,
                                                    ]);
                                                }
                                            }}
                                        />
                                    )}
                                </For>
                            </Gtk.Box>
                        </Gtk.ScrolledWindow>
                    </Gtk.Popover>
                </Gtk.MenuButton>
            </Adw.ActionRow>
            <For each={general.timezones}>
                {(tz: string) => (
                    <Adw.ActionRow
                        title={tz.replaceAll('_', ' ')}
                        subtitle={(() => {
                            const gtz = GLib.TimeZone.new(tz);
                            const now = GLib.DateTime.new_now(gtz);
                            return now.format('%H:%M') ?? '';
                        })()}
                    >
                        <Gtk.Button
                            $type="suffix"
                            cssClasses={['circular', 'destructive-action']}
                            iconName="list-remove-symbolic"
                            onClicked={() => {
                                const current = general.timezones();
                                general.setTimezones(
                                    current.filter(t => t !== tz)
                                );
                            }}
                        />
                    </Adw.ActionRow>
                )}
            </For>
        </Adw.PreferencesGroup>
    );
};
