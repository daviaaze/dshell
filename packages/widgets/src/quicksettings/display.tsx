import Gtk from 'gi://Gtk?version=4.0';
import type {MonitorEntry} from '@shade/services/display/layout';
import DisplayLayout from '@shade/services/display/layout';
import {bus} from '@shade/services/bus';
import {bind, For} from 'gnim';

const SPACING = 8;

/**
 * Display section of quick settings — layout picker plus per-monitor
 * enable/disable switches. Hidden entirely when the host defines no
 * layouts (single-monitor setups without shade-layout configuration).
 */
export const DisplaySection = () => {
    const layout = DisplayLayout.get_default();

    const LayoutPicker = () => {
        // Radio group: the first materialized button becomes the group
        // owner; later buttons join it in their ref callback.
        let groupBtn: Gtk.CheckButton | null = null;
        return (
            <Gtk.Box
                cssClasses={['toolbar', 'linked']}
                orientation={Gtk.Orientation.VERTICAL}
            >
                <For each={bind(layout, 'layouts')}>
                    {(name: string) => (
                        <Gtk.CheckButton
                            label={name}
                            active={bind(layout, 'currentLayout').as((c) => c === name)}
                            ref={(self) => {
                                if (groupBtn === null) groupBtn = self;
                                else self.set_group(groupBtn);
                            }}
                            onToggled={(self) => {
                                if (self.active) bus.emit('display:layout:apply', name);
                            }}
                        />
                    )}
                </For>
            </Gtk.Box>
        );
    };

    const MonitorRow = (m: MonitorEntry) => (
        <Gtk.Box spacing={SPACING} valign={Gtk.Align.CENTER}>
            <Gtk.Label
                label={m.description || m.name}
                hexpand
                xalign={0}
                cssClasses={['body']}
                maxWidthChars={28}
                ellipsize={3}
            />
            <Gtk.Switch
                active={m.enabled}
                onNotifyActive={(self) =>
                    bus.emit('display:monitor:set-enabled', {
                        description: m.description || m.name,
                        enabled: self.active,
                    })
                }
            />
        </Gtk.Box>
    );

    return (
        <Gtk.Box
            spacing={SPACING}
            orientation={Gtk.Orientation.VERTICAL}
            visible={bind(layout, 'layouts').as((l) => l.length > 0)}
        >
            <Gtk.Label label="Display" xalign={0} cssClasses={['caption', 'heading']} />
            <LayoutPicker />
            <Gtk.Box spacing={SPACING} orientation={Gtk.Orientation.VERTICAL}>
                <For each={bind(layout, 'monitors')}>
                    {(m: MonitorEntry) => MonitorRow(m)}
                </For>
            </Gtk.Box>
        </Gtk.Box>
    );
};
