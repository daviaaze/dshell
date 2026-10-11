import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import LayoutService, {type Layout, type OutputInfo} from '@shade/services/display/layouts';
import {
    type DisplayMode,
    logicalMonitorSize,
    resolveAutoRightPositions,
    setLayoutOutputEnabled,
} from '@shade/services/display/modes';
import {monitorsSettings} from '@shade/services/settings/monitors.gschema';
import {type Accessor, bind, computed, createState, For, onCleanup} from 'gnim';

type Point = {x: number; y: number};
type MonitorSpec = Layout['monitors'][number];
type MirrorChoice = {source: string | null; label: string};
type MonitorUpdate = (spec: MonitorSpec) => MonitorSpec;

interface DraftModel {
    draft: Accessor<Layout>;
    setDraft: (layout: Layout) => void;
    setIfChanged: (layout: Layout) => boolean;
    invalidate: () => void;
    updateMonitor: (name: string, update: MonitorUpdate) => boolean;
    synchronizeTopology: () => void;
    replaceFromService: () => void;
}

function cloneLayout(layout: Layout): Layout {
    return {
        ...layout,
        monitors: layout.monitors.map((monitor) => ({
            ...monitor,
            mirror: monitor.mirror ?? null,
        })),
        workspaces: {...layout.workspaces},
    };
}

function sameLayout(left: Layout, right: Layout): boolean {
    if (
        left.auto !== right.auto ||
        left.monitors.length !== right.monitors.length ||
        Object.keys(left.workspaces).length !== Object.keys(right.workspaces).length
    ) {
        return false;
    }
    if (
        Object.entries(left.workspaces).some(
            ([workspace, monitor]) => right.workspaces[Number(workspace)] !== monitor
        )
    ) {
        return false;
    }
    return left.monitors.every((monitor, index) => {
        const other = right.monitors[index];
        return (
            monitor.name === other.name &&
            monitor.resolution === other.resolution &&
            monitor.position === other.position &&
            monitor.scale === other.scale &&
            monitor.transform === other.transform &&
            monitor.vrr === other.vrr &&
            monitor.disabled === other.disabled &&
            (monitor.mirror ?? null) === (other.mirror ?? null)
        );
    });
}

function sameMonitorSpec(left: MonitorSpec, right: MonitorSpec) {
    return (
        left.name === right.name &&
        left.resolution === right.resolution &&
        left.position === right.position &&
        left.scale === right.scale &&
        left.transform === right.transform &&
        left.vrr === right.vrr &&
        left.disabled === right.disabled &&
        (left.mirror ?? null) === (right.mirror ?? null)
    );
}

function modeLabel(mode: string, outputs: OutputInfo[]) {
    const hasInternal = outputs.some((output) => /^eDP-/.test(output.name));
    const externalCount = outputs.length - (hasInternal ? 1 : 0);
    switch (mode) {
        case 'internal-only':
            return 'Internal only';
        case 'external-only':
            return `External only — ${externalCount} displays`;
        case 'extend':
            return `Extend — ${outputs.length} displays`;
        case 'duplicate':
            return `Duplicate — all ${outputs.length} displays`;
        default:
            return mode;
    }
}

function buildMirrorChoices(
    layout: Layout,
    target: MonitorSpec,
    outputs: OutputInfo[]
): MirrorChoice[] {
    const candidates = layout.monitors.flatMap((spec) => {
        if (spec.name === target.name || spec.disabled || spec.mirror) return [];
        const output = outputs.find((item) => item.name === spec.name);
        const description = output?.description || spec.description || spec.name;
        return [{source: spec.name, label: `${description} (${spec.name})`}];
    });
    const currentMirror = target.mirror ?? null;
    const hasCurrentCandidate = candidates.some((choice) => choice.source === currentMirror);
    return [
        ...(currentMirror && !hasCurrentCandidate
            ? [{source: currentMirror, label: `Unavailable: ${currentMirror}`}]
            : []),
        {source: null, label: 'Independent display'},
        ...candidates,
    ];
}

function createDraftModel(service: LayoutService, onChange: () => void): DraftModel {
    const [draft, setDraft] = createState<Layout>({monitors: [], workspaces: {}});
    let observedTopology: string | null = null;
    let initialized = false;

    const invalidate = () => onChange();
    const setIfChanged = (next: Layout) => {
        if (sameLayout(draft(), next)) return false;
        setDraft(next);
        invalidate();
        return true;
    };
    const replaceFromService = () => setIfChanged(cloneLayout(service.captureLayout()));
    const synchronizeTopology = () => {
        const nextTopology = service.monitors
            .map((monitor) => monitor.name)
            .sort((left, right) => left.localeCompare(right))
            .join('\0');
        if (!initialized || observedTopology !== nextTopology) {
            initialized = true;
            observedTopology = nextTopology;
            replaceFromService();
        }
    };
    const updateMonitor = (name: string, update: MonitorUpdate) => {
        const current = draft();
        const previous = current.monitors.find((monitor) => monitor.name === name);
        if (!previous) return false;
        const updated = update(previous);
        if (sameMonitorSpec(previous, updated)) return false;
        setDraft({
            ...current,
            monitors: current.monitors.map((monitor) => {
                if (monitor.name === name) return updated;
                if (updated.position !== previous.position && monitor.mirror === name) {
                    return {...monitor, position: updated.position};
                }
                return monitor;
            }),
        });
        invalidate();
        return true;
    };
    const notifySignal = service.connect('notify', (_source, pspec) => {
        if (pspec.name === 'monitors') synchronizeTopology();
    });
    onCleanup(() => service.disconnect(notifySignal));

    return {
        draft,
        setDraft,
        setIfChanged,
        invalidate,
        updateMonitor,
        synchronizeTopology,
        replaceFromService,
    };
}

function hasIndependentOverlap(layout: Layout, outputs: OutputInfo[]) {
    const positioned = resolveAutoRightPositions(layout, outputs);
    return positioned.monitors.some((monitor, index) => {
        if (monitor.disabled || monitor.mirror) return false;
        const [x, y] = monitor.position.split('x').map(Number);
        const output = outputs.find((item) => item.name === monitor.name);
        if (!output) return false;
        const size = logicalMonitorSize(monitor, output);
        return positioned.monitors.slice(index + 1).some((other) => {
            if (other.disabled || other.mirror) return false;
            const [otherX, otherY] = other.position.split('x').map(Number);
            const otherOutput = outputs.find((item) => item.name === other.name);
            if (!otherOutput) return false;
            const otherSize = logicalMonitorSize(other, otherOutput);
            return (
                x < otherX + otherSize.width &&
                otherX < x + size.width &&
                y < otherY + otherSize.height &&
                otherY < y + size.height
            );
        });
    });
}

function normalizeDraft(layout: Layout, outputs: OutputInfo[]): Layout {
    const positioned = resolveAutoRightPositions(layout, outputs);
    const independent = positioned.monitors.filter(
        (monitor) => !monitor.disabled && !monitor.mirror
    );
    if (independent.length === 0) return cloneLayout(positioned);
    const minX = Math.min(...independent.map((monitor) => Number(monitor.position.split('x')[0])));
    const minY = Math.min(...independent.map((monitor) => Number(monitor.position.split('x')[1])));
    const positions = new Map<string, string>();
    for (const monitor of independent) {
        const [x, y] = monitor.position.split('x').map(Number);
        positions.set(monitor.name, `${x - minX}x${y - minY}`);
    }
    return {
        ...cloneLayout(positioned),
        monitors: positioned.monitors.map((monitor) => {
            if (monitor.disabled) return monitor;
            if (monitor.mirror) {
                const sourcePosition = positions.get(monitor.mirror);
                return sourcePosition ? {...monitor, position: sourcePosition} : monitor;
            }
            const position = positions.get(monitor.name);
            return position ? {...monitor, position} : monitor;
        }),
    };
}

function createPreviewActions(
    service: LayoutService,
    model: DraftModel,
    onConfirmed: (layout: Layout) => void
) {
    let previewKind: 'draft' | 'other' | null = null;
    let confirmInProgress = false;

    const applyDraft = async () => {
        const submitted = cloneLayout(model.draft());
        if (hasIndependentOverlap(submitted, service.monitors)) return;
        const candidate = normalizeDraft(submitted, service.monitors);
        const ok = await service.preview(candidate).catch(() => false);
        if (!ok) return;
        previewKind = 'draft';
        if (sameLayout(model.draft(), submitted)) model.setIfChanged(candidate);
    };
    const previewMode = async (mode: DisplayMode) => {
        const ok = await service.previewMode(mode).catch(() => false);
        if (!ok) return;
        previewKind = 'other';
        model.setDraft(cloneLayout(service.captureLayout()));
        model.invalidate();
    };
    const previewProfile = async (layout: Layout) => {
        const ok = await service.preview(layout).catch(() => false);
        if (ok) previewKind = 'other';
    };
    const confirm = async () => {
        if (service.pending === null) return;
        confirmInProgress = true;
        let confirmed = false;
        try {
            confirmed = await service.confirm();
        } catch {
            confirmed = false;
        } finally {
            confirmInProgress = false;
        }
        if (!confirmed) {
            if (service.pending === null) {
                if (previewKind === 'other') model.replaceFromService();
                previewKind = null;
            }
            return;
        }
        try {
            onConfirmed(cloneLayout(service.captureLayout()));
        } catch {
            // A failed capture cannot make an unconfirmed preview appear saveable.
        }
        previewKind = null;
    };
    const revert = async () => {
        await service.revert().catch(() => undefined);
    };
    const notifySignal = service.connect('notify', (_source, pspec) => {
        if (pspec.name === 'pending' && service.pending === null && !confirmInProgress) {
            const completedKind = previewKind;
            previewKind = null;
            if (completedKind === 'other') model.replaceFromService();
        }
    });
    const appliedSignal = service.connect('applied', () => {
        if (service.pending === null && !confirmInProgress) model.replaceFromService();
    });
    onCleanup(() => {
        service.disconnect(notifySignal);
        service.disconnect(appliedSignal);
    });

    return {applyDraft, previewMode, previewProfile, confirm, revert};
}

function DisplayModeChoices({
    service,
    onPreview,
}: {
    service: LayoutService;
    onPreview: (mode: DisplayMode) => void;
}) {
    const modes = bind(service, 'availableDisplayModes');
    const displayMode = bind(service, 'displayMode');
    const outputs = bind(service, 'monitors');
    return (
        <Adw.PreferencesGroup title="Display modes">
            <Gtk.Box spacing={8}>
                <For each={modes}>
                    {(value: string) => {
                        const mode = value as DisplayMode;
                        return (
                            <Gtk.Button
                                hexpand
                                sensitive={modes.as((choices) => choices.includes(mode))}
                                cssClasses={displayMode.as((currentMode) =>
                                    currentMode === mode ? ['suggested-action'] : []
                                )}
                                tooltipText={
                                    mode === 'duplicate'
                                        ? 'Duplicates every attached display. Different resolutions or aspect ratios may scale or stretch the image.'
                                        : undefined
                                }
                                onClicked={() => onPreview(mode)}
                            >
                                <Adw.ButtonContent
                                    iconName="video-display-symbolic"
                                    label={outputs.as((attached) => modeLabel(mode, attached))}
                                />
                            </Gtk.Button>
                        );
                    }}
                </For>
            </Gtk.Box>
        </Adw.PreferencesGroup>
    );
}

function arrangementGeometry(layout: Layout, outputs: OutputInfo[], width: number, height: number) {
    const active = layout.monitors.flatMap((spec) => {
        if (spec.disabled || spec.mirror) return [];
        const output = outputs.find((item) => item.name === spec.name);
        if (!output) return [];
        const [x, y] = spec.position.split('x').map(Number);
        const size = logicalMonitorSize(spec, output);
        return [{x, y, ...size}];
    });
    if (active.length === 0) return null;
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

function ArrangementCanvas({
    service,
    draft,
    updateMonitor,
    onCanvas,
}: {
    service: LayoutService;
    draft: Accessor<Layout>;
    updateMonitor: DraftModel['updateMonitor'];
    onCanvas: (canvas: Gtk.DrawingArea | null) => void;
}) {
    let dragging: {name: string; factor: number; origin: Point} | null = null;
    let canvas: Gtk.DrawingArea | null = null;
    return (
        <Gtk.DrawingArea
            contentWidth={480}
            contentHeight={250}
            heightRequest={250}
            hexpand
            ref={(self) => {
                canvas = self;
                onCanvas(self);
                self.set_draw_func((_area, cr, width, height) =>
                    service.drawArrangement(cr, width, height, draft())
                );
                const drag = Gtk.GestureDrag.new();
                drag.connect('drag-begin', (_gesture, x, y) => {
                    const current = resolveAutoRightPositions(draft(), service.monitors);
                    const geometry = arrangementGeometry(
                        current,
                        service.monitors,
                        self.get_width(),
                        self.get_height()
                    );
                    if (!geometry) return;
                    const logicalX = (x - 12) / geometry.factor + geometry.left;
                    const logicalY = (y - 12) / geometry.factor + geometry.top;
                    const selected = current.monitors.find((spec) => {
                        if (spec.disabled || spec.mirror) return false;
                        const output = service.monitors.find((entry) => entry.name === spec.name);
                        if (!output) return false;
                        const [originX, originY] = spec.position.split('x').map(Number);
                        const size = logicalMonitorSize(spec, output);
                        return (
                            logicalX >= originX &&
                            logicalY >= originY &&
                            logicalX <= originX + size.width &&
                            logicalY <= originY + size.height
                        );
                    });
                    if (!selected) return;
                    const [originX, originY] = selected.position.split('x').map(Number);
                    dragging = {
                        name: selected.name,
                        factor: geometry.factor,
                        origin: {x: originX, y: originY},
                    };
                });
                drag.connect('drag-end', (_gesture, dx, dy) => {
                    if (!dragging) return;
                    const position = `${Math.round(dragging.origin.x + dx / dragging.factor)}x${Math.round(dragging.origin.y + dy / dragging.factor)}`;
                    updateMonitor(dragging.name, (spec) => ({...spec, position}));
                    dragging = null;
                    self.queue_draw();
                });
                self.add_controller(drag);
                onCleanup(() => {
                    self.remove_controller(drag);
                    onCanvas(null);
                    canvas = null;
                });
            }}
            onResize={() => canvas?.queue_draw()}
            css="background: @view_bg_color; border-radius: 8px;"
        />
    );
}

function DisplayLayoutGroup({
    service,
    draft,
    updateMonitor,
    onCanvas,
}: {
    service: LayoutService;
    draft: Accessor<Layout>;
    updateMonitor: DraftModel['updateMonitor'];
    onCanvas: (canvas: Gtk.DrawingArea | null) => void;
}) {
    const outputs = bind(service, 'monitors');
    return (
        <Adw.PreferencesGroup title="Display Layout">
            <ArrangementCanvas
                service={service}
                draft={draft}
                updateMonitor={updateMonitor}
                onCanvas={onCanvas}
            />
            <Adw.ActionRow
                title="Arrangement"
                subtitle={outputs.as(
                    (attached) =>
                        `${attached.filter((item) => item.enabled).length} active of ${attached.length} attached`
                )}
            />
            <Adw.ActionRow
                title="Window tiling"
                subtitle="Display modes change screens, not how windows tile. Configure tiling per workspace in Hyprland."
            />
        </Adw.PreferencesGroup>
    );
}

function MirrorSourceRow({
    service,
    layout,
    monitor,
    updateMonitor,
}: {
    service: LayoutService;
    layout: Layout;
    monitor: MonitorSpec | undefined;
    updateMonitor: DraftModel['updateMonitor'];
}) {
    if (!monitor) return null;
    const choices = buildMirrorChoices(layout, monitor, service.monitors);
    const selectedIndex = Math.max(
        0,
        choices.findIndex((choice) => choice.source === (monitor.mirror ?? null))
    );
    return (
        <Adw.ComboRow
            title="Mirror source"
            selected={selectedIndex}
            sensitive={!monitor.disabled}
            onNotifySelected={(row) => {
                const selected = choices[row.selected];
                if (!selected || (monitor.mirror ?? null) === selected.source) return;
                const source = selected.source
                    ? layout.monitors.find((spec) => spec.name === selected.source)
                    : null;
                updateMonitor(monitor.name, (spec) => ({
                    ...spec,
                    mirror: selected.source,
                    position: source?.position ?? spec.position,
                }));
            }}
        >
            <Gtk.StringList strings={choices.map((choice) => choice.label)} />
        </Adw.ComboRow>
    );
}

function ResolutionRow({
    monitor,
    output,
    updateMonitor,
}: {
    monitor: MonitorSpec | undefined;
    output: OutputInfo;
    updateMonitor: DraftModel['updateMonitor'];
}) {
    const modes = output.modes.map(
        (mode) => `${mode.width}x${mode.height}@${mode.refreshRate.toFixed(2)}`
    );
    const modeIndex = Math.max(0, modes.indexOf(monitor?.resolution ?? output.resolution));
    return (
        <Adw.ComboRow
            title="Resolution and refresh rate"
            selected={modeIndex}
            sensitive={modes.length > 0 && !!monitor && !monitor.disabled}
            onNotifySelected={(row) => {
                if (!monitor) return;
                const mode = modes[row.selected];
                if (mode && mode !== monitor.resolution) {
                    updateMonitor(monitor.name, (spec) => ({...spec, resolution: mode}));
                }
            }}
        >
            <Gtk.StringList strings={modes} />
        </Adw.ComboRow>
    );
}

function ScaleRow({
    monitor,
    output,
    updateMonitor,
}: {
    monitor: MonitorSpec | undefined;
    output: OutputInfo;
    updateMonitor: DraftModel['updateMonitor'];
}) {
    return (
        <Adw.ActionRow title="Scale">
            <Gtk.SpinButton
                adjustment={Gtk.Adjustment.new(
                    monitor?.scale ?? output.scale,
                    0.5,
                    3,
                    0.05,
                    0.1,
                    0
                )}
                digits={2}
                sensitive={!!monitor && !monitor.disabled}
                onValueChanged={(spin) => {
                    if (monitor && Math.abs(monitor.scale - spin.value) > 0.0001) {
                        updateMonitor(monitor.name, (spec) => ({...spec, scale: spin.value}));
                    }
                }}
            />
        </Adw.ActionRow>
    );
}

function RotationRow({
    monitor,
    output,
    updateMonitor,
}: {
    monitor: MonitorSpec | undefined;
    output: OutputInfo;
    updateMonitor: DraftModel['updateMonitor'];
}) {
    return (
        <Adw.ComboRow
            title="Rotation"
            selected={(monitor?.transform ?? output.transform) % 4}
            sensitive={!!monitor && !monitor.disabled}
            onNotifySelected={(row) => {
                if (monitor && row.selected !== monitor.transform % 4) {
                    updateMonitor(monitor.name, (spec) => ({
                        ...spec,
                        transform: row.selected,
                    }));
                }
            }}
        >
            <Gtk.StringList
                strings={['Normal', '90° clockwise', '180°', '90° counter-clockwise']}
            />
        </Adw.ComboRow>
    );
}

function DisplayPowerRow({service, output}: {service: LayoutService; output: OutputInfo}) {
    return (
        <Adw.ActionRow title="Display power">
            <Gtk.Switch
                active={output.dpms}
                onNotifyActive={(self) => {
                    if (self.active !== output.dpms) {
                        void service.setDpms(output.name, self.active).catch(() => undefined);
                    }
                }}
            />
        </Adw.ActionRow>
    );
}

function DisplayOutputEditor({
    service,
    output,
    layout,
    updateMonitor,
    setDraftIfChanged,
}: {
    service: LayoutService;
    output: OutputInfo;
    layout: Layout;
    updateMonitor: DraftModel['updateMonitor'];
    setDraftIfChanged: DraftModel['setIfChanged'];
}) {
    const monitor = layout.monitors.find((spec) => spec.name === output.name);
    if (!monitor) return null;
    const enabled = !monitor.disabled;
    const mirrorCaption = monitor.mirror ? ` · Mirrors ${monitor.mirror}` : '';
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
            <Adw.ActionRow
                title={output.description || output.name}
                subtitle={`${enabled ? 'Enabled' : 'Disabled'} · ${monitor.resolution}${mirrorCaption}`}
            >
                <Gtk.Switch
                    active={enabled}
                    onNotifyActive={(self) => {
                        const current = layout.monitors.find((spec) => spec.name === output.name);
                        if (!current || current.disabled === !self.active) return;
                        const next = setLayoutOutputEnabled(layout, output.name, self.active);
                        if (next) setDraftIfChanged(next);
                        else self.active = !current.disabled;
                    }}
                />
            </Adw.ActionRow>
            <MirrorSourceRow
                service={service}
                layout={layout}
                monitor={monitor}
                updateMonitor={updateMonitor}
            />
            <ResolutionRow monitor={monitor} output={output} updateMonitor={updateMonitor} />
            <ScaleRow monitor={monitor} output={output} updateMonitor={updateMonitor} />
            <RotationRow monitor={monitor} output={output} updateMonitor={updateMonitor} />
            <DisplayPowerRow service={service} output={output} />
        </Gtk.Box>
    );
}

function ConnectedDisplays({
    service,
    draft,
    updateMonitor,
    setDraftIfChanged,
}: {
    service: LayoutService;
    draft: Accessor<Layout>;
    updateMonitor: DraftModel['updateMonitor'];
    setDraftIfChanged: DraftModel['setIfChanged'];
}) {
    const outputs = bind(service, 'monitors');
    const editorRows = computed(() => {
        const layout = draft();
        return outputs().map((output) => (
            <DisplayOutputEditor
                service={service}
                output={output}
                layout={layout}
                updateMonitor={updateMonitor}
                setDraftIfChanged={setDraftIfChanged}
            />
        ));
    });
    return <Adw.PreferencesGroup title="Connected Displays">{editorRows}</Adw.PreferencesGroup>;
}

function SavedLayouts({
    service,
    saveEligible,
    onApply,
    onSave,
}: {
    service: LayoutService;
    saveEligible: Accessor<boolean>;
    onApply: (name: string) => void;
    onSave: (name: string) => void;
}) {
    const [layoutName, setLayoutName] = createState('');
    return (
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
                        <Gtk.Button label="Apply" onClicked={() => onApply(name)} />
                        <Gtk.Button label="Delete" onClicked={() => service.remove(name)} />
                    </Adw.ActionRow>
                ))
            )}
            <Adw.ActionRow title="Save current arrangement">
                <Gtk.Entry
                    placeholderText="Layout name"
                    hexpand
                    onChanged={(self) => setLayoutName(self.text)}
                />
                <Gtk.Button
                    label="Save layout"
                    sensitive={saveEligible}
                    onClicked={() => onSave(layoutName())}
                />
            </Adw.ActionRow>
        </Adw.PreferencesGroup>
    );
}

export default () => {
    const service = LayoutService.get_default();
    let canvas: Gtk.DrawingArea | null = null;
    let confirmedDraft: Layout | null = null;
    const [saveEligible, setSaveEligible] = createState(false);
    const model = createDraftModel(service, () => {
        setSaveEligible(false);
        canvas?.queue_draw();
    });
    const saveCurrent = (name: string) => {
        if (!confirmedDraft || !name.trim()) return;
        if (service.save(name, confirmedDraft)) {
            confirmedDraft = null;
            setSaveEligible(false);
        }
    };
    const actions = createPreviewActions(service, model, (layout) => {
        model.setDraft(layout);
        confirmedDraft = cloneLayout(layout);
        setSaveEligible(true);
        canvas?.queue_draw();
    });

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={18}
            onMap={model.synchronizeTopology}
        >
            <DisplayModeChoices service={service} onPreview={actions.previewMode} />
            <DisplayLayoutGroup
                service={service}
                draft={model.draft}
                updateMonitor={model.updateMonitor}
                onCanvas={(area) => {
                    canvas = area;
                }}
            />
            <ConnectedDisplays
                service={service}
                draft={model.draft}
                updateMonitor={model.updateMonitor}
                setDraftIfChanged={model.setIfChanged}
            />
            <SavedLayouts
                service={service}
                saveEligible={saveEligible}
                onApply={(name) => {
                    const layout = service.get(name);
                    if (layout) void actions.previewProfile(layout);
                }}
                onSave={saveCurrent}
            />
            <Gtk.Box spacing={8}>
                <Gtk.Button label="Apply" hexpand onClicked={() => void actions.applyDraft()} />
                <Gtk.Button
                    label="Keep Changes"
                    hexpand
                    visible={bind(service, 'pending').as((deadline) => deadline !== null)}
                    onClicked={() => void actions.confirm()}
                />
                <Gtk.Button
                    label="Revert"
                    hexpand
                    visible={bind(service, 'pending').as((deadline) => deadline !== null)}
                    onClicked={() => void actions.revert()}
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
