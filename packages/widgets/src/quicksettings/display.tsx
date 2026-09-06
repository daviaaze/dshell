import Gtk from 'gi://Gtk?version=4.0';
import {bind, For} from 'gnim';
import type {MonitorEntry} from '@shade/services/display/layout';
import DisplayLayout from '@shade/services/display/layout';
import {bus} from '@shade/services/bus';
import {QuickToggleButton} from '../common/quickToggleButton';

const SPACING = 8;

/**
 * Display controls — layout picker + per-monitor enable/disable.
 * Style-matched to the shell: QuickToggleButton (raised/active) for
 * layouts and monitors, caption headers like sliders/button-grid.
 * Hidden when host defines no layouts.
 */
export const DisplaySection = () => {
    const layout = DisplayLayout.get_default();

    return (
        <Gtk.Box
            spacing={SPACING}
            orientation={Gtk.Orientation.VERTICAL}
            visible={bind(layout, 'layouts').as((l) => l.length > 0)}
        >
            <Gtk.Box spacing={8}>
                <Gtk.Label label="Display" xalign={0} cssClasses={['caption']} hexpand />
                <Gtk.Label
                    label={bind(layout, 'currentLayout').as((c) => (c ? c : 'no match'))}
                    xalign={1}
                    cssClasses={['caption']}
                />
            </Gtk.Box>

            <Gtk.Label
                visible={bind(layout, 'layouts').as((l) => l.length > 1)}
                label="Layouts"
                xalign={0}
                cssClasses={['caption']}
            />
            <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
                <For each={bind(layout, 'layouts')}>
                    {(name: string) => (
                        <QuickToggleButton
                            icon="video-display-symbolic"
                            label={name}
                            active={bind(layout, 'currentLayout').as((c) => c === name)}
                            onClick={() => bus.emit('display:layout:apply', name)}
                        />
                    )}
                </For>
            </Gtk.Box>

            <Gtk.Label
                visible={bind(layout, 'monitors').as((ms) => ms.length > 1)}
                label="Monitores"
                xalign={0}
                cssClasses={['caption']}
            />
            <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
                <For each={bind(layout, 'monitors')}>
                    {(m: MonitorEntry) => (
                        <QuickToggleButton
                            icon="video-display-symbolic"
                            label={m.description || m.name}
                            active={m.enabled}
                            onClick={() =>
                                bus.emit('display:monitor:set-enabled', {
                                    description: m.description || m.name,
                                    enabled: !m.enabled,
                                })
                            }
                        />
                    )}
                </For>
            </Gtk.Box>
        </Gtk.Box>
    );
};
