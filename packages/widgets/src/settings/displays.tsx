import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import LayoutService, {type Layout, type OutputInfo} from '@shade/services/display/layouts';
import {monitorsSettings} from '@shade/services/settings/monitors.gschema';
import {bind} from 'gnim';

type Point = {x: number; y: number};

export default () => {
    const service = LayoutService.get_default();
    let draft: Layout = {monitors: [], workspaces: {}};
    let layoutName = '';
    let confirmedDraft: Layout | null = null;
    let saveButton: Gtk.Button | null = null;
    let dragging: {name: string; factor: number; origin: Point} | null = null;
    let canvas: Gtk.DrawingArea | null = null;

    const markDraftChanged = () => {
        confirmedDraft = null;
        if (saveButton) saveButton.sensitive = false;
    };

    const captureDraft = () => {
        draft = service.captureLayout();
    };

    const apply = () => {
        const overlaps = draft.monitors.some((monitor, index) => {
            if (monitor.disabled) return false;
            const [x, y] = monitor.position.split('x').map(Number);
            const output = service.monitors.find((item) => item.name === monitor.name);
            if (!output) return false;
            const size = monitorSize(monitor, output);
            return draft.monitors.slice(index + 1).some((other) => {
                if (other.disabled) return false;
                const [ox, oy] = other.position.split('x').map(Number);
                const next = service.monitors.find((item) => item.name === other.name);
                if (!next) return false;
                const otherSize = monitorSize(other, next);
                return (
                    x < ox + otherSize.width &&
                    ox < x + size.width &&
                    y < oy + otherSize.height &&
                    oy < y + size.height
                );
            });
        });
        if (overlaps) return;
        const active = draft.monitors.filter((monitor) => !monitor.disabled);
        if (!active.length) return;
        const minX = Math.min(...active.map((monitor) => Number(monitor.position.split('x')[0])));
        const minY = Math.min(...active.map((monitor) => Number(monitor.position.split('x')[1])));
        const candidate: Layout = {
            ...draft,
            monitors: draft.monitors.map((monitor) => {
                const [x, y] = monitor.position.split('x').map(Number);
                return {
                    ...monitor,
                    position: monitor.disabled ? monitor.position : `${x - minX}x${y - minY}`,
                };
            }),
        };
        void service.preview(candidate).then((ok) => {
            if (!ok) return;
            draft = candidate;
            markDraftChanged();
            canvas?.queue_draw();
        });
    };

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={18} onMap={() => captureDraft()}>
            <Adw.PreferencesGroup title="Display Layout">
                <Gtk.DrawingArea
                    contentWidth={480}
                    contentHeight={250}
                    heightRequest={250}
                    hexpand
                    ref={(self) => {
                        canvas = self;
                        self.set_draw_func((_area, cr, width, height) =>
                            service.drawArrangement(cr, width, height, draft)
                        );
                        const drag = Gtk.GestureDrag.new();
                        drag.connect('drag-begin', (_gesture, x, y) => {
                            const geometry = arrangementGeometry(
                                draft,
                                service.monitors,
                                self.get_width(),
                                self.get_height()
                            );
                            if (!geometry) return;
                            const logicalX = (x - 12) / geometry.factor + geometry.left;
                            const logicalY = (y - 12) / geometry.factor + geometry.top;
                            const output = draft.monitors.find((spec) => {
                                if (spec.disabled) return false;
                                const item = service.monitors.find(
                                    (entry) => entry.name === spec.name
                                );
                                if (!item) return false;
                                const [originX, originY] = spec.position.split('x').map(Number);
                                const size = monitorSize(spec, item);
                                return (
                                    logicalX >= originX &&
                                    logicalY >= originY &&
                                    logicalX <= originX + size.width &&
                                    logicalY <= originY + size.height
                                );
                            });
                            if (!output) return;
                            const [originX, originY] = output.position.split('x').map(Number);
                            dragging = {
                                name: output.name,
                                factor: geometry.factor,
                                origin: {x: originX, y: originY},
                            };
                        });
                        drag.connect('drag-end', (_gesture, dx, dy) => {
                            if (!dragging) return;
                            const monitor = draft.monitors.find(
                                (item) => item.name === dragging?.name
                            );
                            if (monitor) {
                                monitor.position = `${Math.round(dragging.origin.x + dx / dragging.factor)}x${Math.round(dragging.origin.y + dy / dragging.factor)}`;
                                markDraftChanged();
                            }
                            dragging = null;
                            self.queue_draw();
                        });
                        self.add_controller(drag);
                    }}
                    onResize={() => canvas?.queue_draw()}
                    css="background: @view_bg_color; border-radius: 8px;"
                />
                <Adw.ActionRow
                    title="Arrangement"
                    subtitle={bind(service, 'monitors').as(
                        (outputs) =>
                            `${outputs.filter((item) => item.enabled).length} active of ${outputs.length} attached`
                    )}
                />
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup title="Connected Displays">
                {bind(service, 'monitors').as((outputs) => {
                    if (service.pending === null && outputs.length > 0) {
                        draft = service.captureLayout();
                        markDraftChanged();
                        canvas?.queue_draw();
                    }
                    return outputs.map((monitor: OutputInfo) => {
                        const item = draft.monitors.find((entry) => entry.name === monitor.name);
                        const modes = monitor.modes.map(
                            (mode) => `${mode.width}x${mode.height}@${mode.refreshRate.toFixed(2)}`
                        );
                        const modeIndex = Math.max(0, modes.indexOf(monitor.resolution));
                        return (
                            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                                <Adw.ActionRow
                                    title={monitor.description || monitor.name}
                                    subtitle={`${monitor.enabled ? 'Enabled' : 'Disabled'} · ${monitor.resolution}`}
                                >
                                    <Gtk.Switch
                                        active={monitor.enabled}
                                        onNotifyActive={(self) => {
                                            if (!item) return;
                                            item.disabled = !self.active;
                                            markDraftChanged();
                                            canvas?.queue_draw();
                                        }}
                                    />
                                </Adw.ActionRow>
                                <Adw.ComboRow
                                    title="Resolution and refresh rate"
                                    selected={modeIndex}
                                    sensitive={modes.length > 0 && monitor.enabled}
                                    onNotifySelected={(row) => {
                                        if (!item) return;
                                        const mode = modes[row.selected];
                                        if (mode) {
                                            item.resolution = mode;
                                            markDraftChanged();
                                        }
                                    }}
                                >
                                    <Gtk.StringList strings={modes} />
                                </Adw.ComboRow>
                                <Adw.ActionRow title="Scale">
                                    <Gtk.SpinButton
                                        adjustment={Gtk.Adjustment.new(
                                            monitor.scale,
                                            0.5,
                                            3,
                                            0.05,
                                            0.1,
                                            0
                                        )}
                                        digits={2}
                                        sensitive={monitor.enabled}
                                        onValueChanged={(spin) => {
                                            if (item) {
                                                item.scale = spin.value;
                                                markDraftChanged();
                                            }
                                        }}
                                    />
                                </Adw.ActionRow>
                                <Adw.ComboRow
                                    title="Rotation"
                                    selected={monitor.transform % 4}
                                    sensitive={monitor.enabled}
                                    onNotifySelected={(row) => {
                                        if (item) {
                                            item.transform = row.selected;
                                            markDraftChanged();
                                        }
                                    }}
                                >
                                    <Gtk.StringList
                                        strings={[
                                            'Normal',
                                            '90° clockwise',
                                            '180°',
                                            '90° counter-clockwise',
                                        ]}
                                    />
                                </Adw.ComboRow>
                                <Adw.ActionRow title="Display power">
                                    <Gtk.Switch
                                        active={monitor.dpms}
                                        onNotifyActive={(self) =>
                                            void service.setDpms(monitor.name, self.active)
                                        }
                                    />
                                </Adw.ActionRow>
                            </Gtk.Box>
                        );
                    });
                })}
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup title="Saved Layouts">
                <Adw.ActionRow title="Automatically apply matching layouts">
                    <Gtk.Switch
                        active={bind(service, 'autoApply')}
                        onNotifyActive={(self) => {
                            monitorsSettings().setAutoApply(self.active);
                            service.notify('autoApply');
                        }}
                    />
                </Adw.ActionRow>
                {bind(service, 'names').as((names) =>
                    names.map((name) => (
                        <Adw.ActionRow title={name}>
                            <Gtk.Button
                                label="Apply"
                                onClicked={() => {
                                    const profile = service.get(name);
                                    if (profile) void service.preview(profile);
                                }}
                            />
                            <Gtk.Button label="Delete" onClicked={() => service.remove(name)} />
                        </Adw.ActionRow>
                    ))
                )}
                <Adw.ActionRow title="Save current arrangement">
                    <Gtk.Entry
                        placeholderText="Layout name"
                        hexpand
                        onChanged={(self) => (layoutName = self.text)}
                    />
                    <Gtk.Button
                        label="Save layout"
                        sensitive={false}
                        ref={(self) => {
                            saveButton = self;
                            self.sensitive = false;
                        }}
                        onClicked={() => {
                            if (!confirmedDraft || !layoutName.trim()) return;
                            if (service.save(layoutName, confirmedDraft)) {
                                confirmedDraft = null;
                                if (saveButton) saveButton.sensitive = false;
                            }
                        }}
                    />
                </Adw.ActionRow>
            </Adw.PreferencesGroup>

            <Gtk.Box spacing={8}>
                <Gtk.Button label="Apply" hexpand onClicked={apply} />
                <Gtk.Button
                    label="Keep Changes"
                    hexpand
                    visible={bind(service, 'pending').as((deadline) => deadline !== null)}
                    onClicked={() => {
                        service.confirm();
                        confirmedDraft = {
                            ...draft,
                            monitors: draft.monitors.map((monitor) => ({...monitor})),
                        };
                        if (saveButton) saveButton.sensitive = true;
                    }}
                />
                <Gtk.Button
                    label="Revert"
                    hexpand
                    visible={bind(service, 'pending').as((deadline) => deadline !== null)}
                    onClicked={() => void service.revert()}
                />
            </Gtk.Box>
            <Gtk.Label
                visible={bind(service, 'error').as((error) => error !== null)}
                label={bind(service, 'error').as((error) => error ?? '')}
                wrap
                xalign={0}
                cssClasses={['error']}
            />
        </Gtk.Box>
    );
};
function monitorSize(spec: Layout['monitors'][number], output: OutputInfo) {
    const match = /^(\d+)x(\d+)/.exec(spec.resolution);
    const width = Number(match?.[1] ?? output.width);
    const height = Number(match?.[2] ?? output.height);
    const swapsAxes = spec.transform === 1 || spec.transform === 3;
    return {
        width: (swapsAxes ? height : width) / spec.scale,
        height: (swapsAxes ? width : height) / spec.scale,
    };
}
function arrangementGeometry(layout: Layout, outputs: OutputInfo[], width: number, height: number) {
    const active = layout.monitors.flatMap((spec) => {
        if (spec.disabled) return [];
        const output = outputs.find((item) => item.name === spec.name);
        if (!output) return [];
        const [x, y] = spec.position.split('x').map(Number);
        const size = monitorSize(spec, output);
        return [{x, y, ...size}];
    });
    if (!active.length) return null;
    const left = Math.min(...active.map((item) => item.x));
    const top = Math.min(...active.map((item) => item.y));
    const right = Math.max(...active.map((item) => item.x + item.width));
    const bottom = Math.max(...active.map((item) => item.y + item.height));
    return {
        left,
        top,
        factor: Math.min(
            (width - 24) / Math.max(1, right - left),
            (height - 24) / Math.max(1, bottom - top)
        ),
    };
}
