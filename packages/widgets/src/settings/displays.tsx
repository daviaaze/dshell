/**
 * Displays settings page — monitor + layout management.
 *
 * Monitors group: per-monitor physical setup (mode, position, scale,
 * rotation, VRR, enable) applied live through LayoutService.
 * Layouts group: save the current arrangement as a named layout and apply
 * saved layouts later.
 */

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {toArray} from '@shade/core/gjsUtils';
import LayoutService, {type MonitorSpec} from '@shade/services/display/layouts';
import {type AstalHyprland, getHyprland} from '@shade/services/hyprland';
import {monitorsSettings} from '@shade/services/settings/monitors.gschema';
import {bind, For} from 'gnim';

const TRANSFORM_NAMES = ['Normal', '90°', '180°', '270°'];

/** Index of the monitor's current mode inside `modes`, or 0 (preferred). */
function modeIndex(mon: AstalHyprland.Monitor, modes: string[]): number {
    const curWxH = String(mon.currentFormat ?? '').split('@')[0];
    if (!curWxH) return 0;
    const idx = modes.findIndex((m) => m.split('@')[0] === curWxH);
    return idx >= 0 ? idx : 0;
}

function MonitorRow({mon}: {mon: AstalHyprland.Monitor}) {
    const service = LayoutService.get_default();
    const modes = toArray<string>(mon.availableModes);
    const modeNames = ['Preferred', ...modes];

    /** Apply a partial change on top of the monitor's live state. */
    const patch = (part: Partial<MonitorSpec>) => {
        service.applySpec({...service.specFor(mon), ...part});
    };

    return (
        <Adw.ExpanderRow
            title={mon.description || mon.name}
            subtitle={`${mon.name} · ${mon.width}×${mon.height}`}
        >
            <Adw.SwitchRow
                title={'Enabled'}
                active={bind(mon, 'disabled').as((d) => !d)}
                onNotifyActive={(self) => service.applyEnabled(mon.name, self.active)}
            />
            <Adw.ActionRow title={'Resolution'}>
                <Gtk.DropDown
                    model={new Gtk.StringList({strings: modeNames})}
                    selected={bind(mon, 'current-format').as((f) => modeIndex(mon, modes))}
                    onNotifySelected={(self) => {
                        const want = modeNames[self.selected];
                        if (!want) return;
                        const cur = String(mon.currentFormat ?? '').split('@')[0];
                        if (want === 'Preferred') {
                            if (cur) patch({resolution: 'preferred'});
                        } else if (want.split('@')[0] !== cur) {
                            patch({resolution: want});
                        }
                    }}
                />
            </Adw.ActionRow>
            <Adw.SpinRow
                title={'Scale'}
                adjustment={new Gtk.Adjustment({lower: 0.5, upper: 3, stepIncrement: 0.25})}
                value={bind(mon, 'scale')}
                onNotifyValue={(self) => {
                    if (Math.abs(self.value - mon.scale) > 0.001) patch({scale: self.value});
                }}
            />
            <Adw.ActionRow title={'Rotation'}>
                <Gtk.DropDown
                    model={new Gtk.StringList({strings: TRANSFORM_NAMES})}
                    selected={bind(mon, 'transform')}
                    onNotifySelected={(self) => {
                        if (self.selected !== mon.transform) patch({transform: self.selected});
                    }}
                />
            </Adw.ActionRow>
            <Adw.SpinRow
                title={'Horizontal Position'}
                adjustment={new Gtk.Adjustment({lower: -20000, upper: 20000, stepIncrement: 10})}
                value={bind(mon, 'x')}
                onNotifyValue={(self) => {
                    if (self.value !== mon.x) patch({position: `${Math.round(self.value)}x${mon.y}`});
                }}
            />
            <Adw.SpinRow
                title={'Vertical Position'}
                adjustment={new Gtk.Adjustment({lower: -20000, upper: 20000, stepIncrement: 10})}
                value={bind(mon, 'y')}
                onNotifyValue={(self) => {
                    if (self.value !== mon.y) patch({position: `${mon.x}x${Math.round(self.value)}`});
                }}
            />
            <Adw.SwitchRow
                title={'Adaptive Sync (VRR)'}
                active={bind(mon, 'vrr').as((v) => !v)}
                onNotifyActive={(self) => patch({vrr: self.active ? 1 : 0})}
            />
        </Adw.ExpanderRow>
    );
}

function LayoutRow({name}: {name: string}) {
    const service = LayoutService.get_default();
    const layout = service.get(name);
    const n = layout?.monitors.length ?? 0;
    const count = `${n} monitor${n === 1 ? '' : 's'}`;

    return (
        <Adw.ActionRow
            title={name}
            subtitle={bind(service, 'current').as((c) => (c === name ? `Active · ${count}` : count))}
        >
            <Gtk.Button
                slot={'suffix'}
                valign={Gtk.Align.CENTER}
                iconName={'system-run-symbolic'}
                tooltipText={`Apply '${name}'`}
                onClicked={() => service.apply(name)}
            />
            <Gtk.Button
                slot={'suffix'}
                valign={Gtk.Align.CENTER}
                iconName={'user-trash-symbolic'}
                tooltipText={`Delete '${name}'`}
                onClicked={() => service.remove(name)}
            />
        </Adw.ActionRow>
    );
}

export default () => {
    const hyprland = getHyprland();
    if (!hyprland) return null;

    return (
        <>
            <Adw.PreferencesGroup
                title={'Monitors'}
                description={'Physical setup — arrangement, rotation, scale, mode'}
            >
                <For each={bind(hyprland, 'monitors')}>
                    {(mon: AstalHyprland.Monitor) => <MonitorRow mon={mon} />}
                </For>
            </Adw.PreferencesGroup>
            <Adw.PreferencesGroup
                title={'Layouts'}
                description={'Named setups — save the current arrangement, apply it later'}
            >
                <Adw.SwitchRow
                    title={'Auto-apply on monitor change'}
                    subtitle={'Best matching saved layout reapplies when monitors connect or disconnect'}
                    active={monitorsSettings().autoApply}
                    onNotifyActive={(self) => monitorsSettings().setAutoApply(self.active)}
                />
                <LayoutSaveRow />
                <For each={bind(LayoutService.get_default(), 'names')}>
                    {(name: string) => <LayoutRow name={name} />}
                </For>
            </Adw.PreferencesGroup>
        </>
    );
};

/** Entry row that snapshots the live setup under a new name. */
function LayoutSaveRow() {
    const service = LayoutService.get_default();
    let entry: Adw.EntryRow | null = null;

    const save = () => {
        if (!entry) return;
        const name = entry.text.trim();
        if (name && service.save(name)) entry.text = '';
    };

    return (
        <Adw.EntryRow title={'New layout name'} ref={(self) => (entry = self)} onEntryActivated={save}>
            <Gtk.Button
                slot={'suffix'}
                valign={Gtk.Align.CENTER}
                iconName={'document-save-symbolic'}
                tooltipText={'Save current setup as this layout'}
                onClicked={save}
            />
        </Adw.EntryRow>
    );
}