import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {cityName} from '@shade/core/time';
import Clock from '@shade/services/time/clock';
import {createState, For} from 'gnim';
import {IconButton} from '../common/iconButton';
import {usePopoverCleanup} from '../common/popoverCleanup';

export default () => {
    const general = generalSettings();
    const wallTime = Clock.get_default().wallTime;

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
        <Adw.PreferencesGroup
            title="Relógios mundiais"
            description="Adicione fusos horários e consulte a hora local."
        >
            <Adw.ActionRow
                title="Adicionar fuso horário"
                subtitle={general.timezones.as((tzs) => tzs.join(', '))}
            >
                <Gtk.MenuButton
                    slot="suffix"
                    ref={usePopoverCleanup}
                    cssClasses={['circular']}
                    iconName="list-add-symbolic"
                    tooltipText="Adicionar fuso horário"
                >
                    <Gtk.Popover slot="popover" position={Gtk.PositionType.LEFT}>
                        <Gtk.ScrolledWindow
                            minContentWidth={240}
                            minContentHeight={0}
                            maxContentHeight={TZ_POPOVER_MAX_HEIGHT}
                            propagateNaturalHeight
                            propagateNaturalWidth
                            hscrollbarPolicy={Gtk.PolicyType.NEVER}
                            vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
                        >
                            <Gtk.Box
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={4}
                                cssClasses={['vertical']}
                            >
                                <For each={PRESET_TIMEZONES}>
                                    {(tz: string) => (
                                        <Gtk.Button
                                            label={tz.replaceAll('_', ' ')}
                                            onClicked={() => {
                                                const current = general.timezones();
                                                if (!current.includes(tz)) {
                                                    general.setTimezones([...current, tz]);
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
                {(tz: string) => {
                    const timezone = GLib.TimeZone.new_identifier(tz);
                    return (
                        <Adw.ActionRow
                            title={cityName(tz)}
                            subtitle={wallTime.as((time) => {
                                const local = timezone
                                    ? time.to_timezone(timezone)?.format('%H:%M')
                                    : null;
                                return `${tz} — ${local ?? 'Hora indisponível'}`;
                            })}
                        >
                            <Gtk.Box slot="suffix" valign={Gtk.Align.CENTER}>
                                <IconButton
                                    icon="list-remove-symbolic"
                                    accessibleLabel={`Remove ${tz} timezone`}
                                    onClicked={() => {
                                        general.setTimezones(
                                            general.timezones().filter((value) => value !== tz)
                                        );
                                    }}
                                />
                            </Gtk.Box>
                        </Adw.ActionRow>
                    );
                }}
            </For>
        </Adw.PreferencesGroup>
    );
};
