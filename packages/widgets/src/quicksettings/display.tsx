import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import LayoutService, {type OutputInfo} from '@shade/services/display/layouts';
import type {DisplayMode} from '@shade/services/display/modes';
import {type Accessor, bind, computed, createState, For, onCleanup} from 'gnim';
import {QuickToggleButton} from '../common/quickToggleButton';

const SPACING = 8;

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

function currentModeLabel(mode: string) {
    switch (mode) {
        case 'internal-only':
            return 'Internal only';
        case 'external-only':
            return 'External only';
        case 'extend':
            return 'Extend';
        case 'duplicate':
            return 'Duplicate';
        default:
            return 'Custom setup';
    }
}

class DisplayFocusController {
    #service: LayoutService;
    #setChooserActive: (active: boolean) => void;
    #root: Gtk.Box | null = null;
    #emptyLabel: Gtk.Label | null = null;
    #revertButton: Gtk.Button | null = null;
    #modeButtons = new Map<DisplayMode, Gtk.Button>();
    #focusIdle: number | null = null;
    #focusKind: 'mode' | 'revert' | null = null;
    #chooserFocusPending = false;
    #revertFocusPending = false;
    #chooserSignal: number;
    #notifySignal: number;

    constructor(service: LayoutService, setChooserActive: (active: boolean) => void) {
        this.#service = service;
        this.#setChooserActive = setChooserActive;
        this.#chooserSignal = service.connect('mode-chooser-requested', () => {
            this.#setChooserActive(true);
            this.#scheduleFocus('mode');
        });
        this.#notifySignal = service.connect('notify', (_source, pspec) =>
            this.#handleNotify(pspec.name)
        );
        onCleanup(() => this.dispose());
    }

    #cancelFocusIdle() {
        if (this.#focusIdle !== null) GLib.Source.remove(this.#focusIdle);
        this.#focusIdle = null;
        this.#focusKind = null;
    }

    #focusModeChoice() {
        const modes = this.#service.availableDisplayModes as DisplayMode[];
        const highlighted = this.#service.displayMode as DisplayMode;
        const mode = modes.includes(highlighted) ? highlighted : modes[0];
        if (mode) {
            const button = this.#modeButtons.get(mode);
            if (button?.get_mapped()) {
                button.grab_focus();
                this.#chooserFocusPending = false;
                return;
            }
        } else if (this.#emptyLabel?.get_mapped()) {
            this.#emptyLabel.grab_focus();
            this.#chooserFocusPending = false;
            return;
        }
        this.#chooserFocusPending = true;
    }

    #scheduleFocus(kind: 'mode' | 'revert') {
        if (kind === 'mode') this.#chooserFocusPending = true;
        else this.#revertFocusPending = true;
        this.#cancelFocusIdle();
        if (!this.#root?.get_mapped()) return;
        this.#focusKind = kind;
        this.#focusIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const pendingKind = this.#focusKind;
            this.#focusIdle = null;
            this.#focusKind = null;
            if (!this.#root?.get_mapped()) return GLib.SOURCE_REMOVE;
            if (pendingKind === 'revert') {
                if (this.#service.pending !== null && this.#revertButton?.get_mapped()) {
                    this.#revertButton.grab_focus();
                    this.#revertFocusPending = false;
                    this.#chooserFocusPending = false;
                }
            } else {
                this.#focusModeChoice();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    #handleNotify(name: string) {
        if (name === 'pending') {
            if (this.#service.pending !== null) this.#scheduleFocus('revert');
            else {
                this.#revertFocusPending = false;
                if (this.#focusKind === 'revert') this.#cancelFocusIdle();
            }
        }
        if (name === 'available-display-modes' || name === 'monitors') {
            const focusedChoice = [...this.#modeButtons].find(([, button]) => button.has_focus());
            if (focusedChoice && !this.#service.availableDisplayModes.includes(focusedChoice[0])) {
                this.#scheduleFocus('mode');
            }
        }
    }

    #handleKey(keyval: number) {
        const modes = this.#service.availableDisplayModes as DisplayMode[];
        const focusedIndex = modes.findIndex((mode) => this.#modeButtons.get(mode)?.has_focus());
        if (focusedIndex < 0) return false;
        let nextIndex: number | null = null;
        if (keyval === Gdk.KEY_Left || keyval === Gdk.KEY_Up) {
            nextIndex = (focusedIndex + modes.length - 1) % modes.length;
        } else if (keyval === Gdk.KEY_Right || keyval === Gdk.KEY_Down) {
            nextIndex = (focusedIndex + 1) % modes.length;
        }
        if (nextIndex === null) return false;
        this.#modeButtons.get(modes[nextIndex])?.grab_focus();
        return true;
    }

    attachRoot(root: Gtk.Box) {
        this.#root = root;
        const mapSignal = root.connect('map', () => {
            if (this.#revertFocusPending && this.#service.pending !== null) {
                this.#scheduleFocus('revert');
            } else if (this.#chooserFocusPending) {
                this.#scheduleFocus('mode');
            }
        });
        const unmapSignal = root.connect('unmap', () => {
            this.#setChooserActive(false);
            this.#chooserFocusPending = false;
            this.#revertFocusPending = this.#service.pending !== null;
            this.#cancelFocusIdle();
        });
        const keyController = Gtk.EventControllerKey.new();
        keyController.connect('key-pressed', (_controller, keyval) => this.#handleKey(keyval));
        root.add_controller(keyController);
        onCleanup(() => {
            this.#cancelFocusIdle();
            root.disconnect(mapSignal);
            root.disconnect(unmapSignal);
            root.remove_controller(keyController);
            this.#root = null;
        });
    }

    attachModeButton(mode: DisplayMode, button: Gtk.Button) {
        this.#modeButtons.set(mode, button);
        const focusSignal = button.connect('notify::has-focus', () => {
            if (button.has_focus()) this.#chooserFocusPending = false;
        });
        const mapSignal = button.connect('map', () => {
            if (this.#chooserFocusPending) this.#scheduleFocus('mode');
        });
        onCleanup(() => {
            button.disconnect(focusSignal);
            button.disconnect(mapSignal);
            if (this.#modeButtons.get(mode) === button) this.#modeButtons.delete(mode);
        });
    }

    attachEmptyLabel(label: Gtk.Label) {
        this.#emptyLabel = label;
        const mapSignal = label.connect('map', () => {
            if (this.#chooserFocusPending) this.#scheduleFocus('mode');
        });
        onCleanup(() => {
            label.disconnect(mapSignal);
            if (this.#emptyLabel === label) this.#emptyLabel = null;
        });
    }

    attachRevertButton(button: Gtk.Button) {
        this.#revertButton = button;
        const mapSignal = button.connect('map', () => {
            if (this.#revertFocusPending && this.#service.pending !== null) {
                this.#scheduleFocus('revert');
            }
        });
        onCleanup(() => {
            button.disconnect(mapSignal);
            if (this.#revertButton === button) this.#revertButton = null;
        });
    }

    dispose() {
        this.#service.disconnect(this.#chooserSignal);
        this.#service.disconnect(this.#notifySignal);
        this.#cancelFocusIdle();
        this.#chooserFocusPending = false;
        this.#revertFocusPending = false;
    }
}

function ModeChooser({
    service,
    active,
    focus,
}: {
    service: LayoutService;
    active: Accessor<boolean>;
    focus: DisplayFocusController;
}) {
    const modes = bind(service, 'availableDisplayModes');
    const displayMode = bind(service, 'displayMode');
    const outputs = bind(service, 'monitors');
    const emptyVisible = computed(() => active() && modes().length === 0);
    return (
        <>
            <Gtk.Label visible={active} label="Display modes" xalign={0} cssClasses={['caption']} />
            <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL} visible={active}>
                <For each={modes}>
                    {(value: string) => {
                        const mode = value as DisplayMode;
                        return (
                            <Gtk.Button
                                ref={(self) => focus.attachModeButton(mode, self)}
                                sensitive={modes.as((choices) => choices.includes(mode))}
                                cssClasses={displayMode.as((currentMode) =>
                                    currentMode === mode ? ['suggested-action'] : []
                                )}
                                tooltipText={
                                    mode === 'duplicate'
                                        ? 'Duplicates every attached display. Different resolutions or aspect ratios may scale or stretch the image.'
                                        : undefined
                                }
                                onClicked={() =>
                                    void service.previewMode(mode).catch(() => undefined)
                                }
                            >
                                <Adw.ButtonContent
                                    iconName="video-display-symbolic"
                                    label={outputs.as((attached) => modeLabel(mode, attached))}
                                />
                            </Gtk.Button>
                        );
                    }}
                </For>
                <Gtk.Label
                    ref={(self) => focus.attachEmptyLabel(self)}
                    label="No attached displays"
                    xalign={0}
                    focusable
                    visible={emptyVisible}
                />
            </Gtk.Box>
        </>
    );
}

function SavedLayoutChoices({service}: {service: LayoutService}) {
    return (
        <>
            <Gtk.Label
                visible={bind(service, 'names').as((names) => names.length > 0)}
                label="Layouts"
                xalign={0}
                cssClasses={['caption']}
            />
            <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
                <For each={bind(service, 'names')}>
                    {(name: string) => (
                        <QuickToggleButton
                            icon="video-display-symbolic"
                            label={name}
                            active={bind(service, 'current').as(
                                (currentName) => currentName === name
                            )}
                            onClick={() => {
                                const layout = service.get(name);
                                if (layout) void service.preview(layout).catch(() => undefined);
                            }}
                        />
                    )}
                </For>
            </Gtk.Box>
        </>
    );
}

function ConnectedOutputChoices({service}: {service: LayoutService}) {
    return (
        <>
            <Gtk.Label
                visible={bind(service, 'monitors').as((outputs) => outputs.length > 1)}
                label="Monitors"
                xalign={0}
                cssClasses={['caption']}
            />
            <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
                <For each={bind(service, 'monitors')}>
                    {(monitor: OutputInfo) => (
                        <QuickToggleButton
                            icon="video-display-symbolic"
                            label={
                                monitor.mirror
                                    ? `${monitor.description || monitor.name} — Mirrors ${monitor.mirror}`
                                    : monitor.description || monitor.name
                            }
                            active={monitor.enabled}
                            onClick={() =>
                                void service
                                    .setEnabled(monitor.name, !monitor.enabled)
                                    .catch(() => undefined)
                            }
                        />
                    )}
                </For>
            </Gtk.Box>
        </>
    );
}

function PreviewControls({
    service,
    focus,
}: {
    service: LayoutService;
    focus: DisplayFocusController;
}) {
    return (
        <>
            <Gtk.Box
                spacing={6}
                visible={bind(service, 'pending').as((deadline) => deadline !== null)}
            >
                <Gtk.Label
                    label="Reverts after 15 seconds unless kept"
                    cssClasses={['caption']}
                    hexpand
                    xalign={0}
                />
                <Gtk.Button
                    label="Keep Changes"
                    hexpand
                    onClicked={() => void service.confirm().catch(() => false)}
                />
                <Gtk.Button
                    ref={(self) => focus.attachRevertButton(self)}
                    label="Revert"
                    hexpand
                    onClicked={() => void service.revert().catch(() => undefined)}
                />
            </Gtk.Box>
            <Gtk.Label
                visible={bind(service, 'error').as((error) => error !== null)}
                label={bind(service, 'error').as((error) => error ?? '')}
                wrap
                xalign={0}
                cssClasses={['error']}
            />
        </>
    );
}

export const DisplaySection = () => {
    const service = LayoutService.get_default();
    const outputs = bind(service, 'monitors');
    const names = bind(service, 'names');
    const displayMode = bind(service, 'displayMode');
    const current = bind(service, 'current');
    const [chooserActive, setChooserActive] = createState(false);
    const focus = new DisplayFocusController(service, setChooserActive);
    const visible = computed(() => outputs().length > 0 || names().length > 0 || chooserActive());
    const headerLabel = computed(() => current() ?? currentModeLabel(displayMode()));

    return (
        <Gtk.Box
            spacing={SPACING}
            orientation={Gtk.Orientation.VERTICAL}
            visible={visible}
            ref={(self) => focus.attachRoot(self)}
        >
            <Gtk.Box spacing={8}>
                <Gtk.Label label="Display" xalign={0} cssClasses={['caption']} hexpand />
                <Gtk.Label label={headerLabel} xalign={1} cssClasses={['caption']} />
            </Gtk.Box>
            <ModeChooser service={service} active={chooserActive} focus={focus} />
            <SavedLayoutChoices service={service} />
            <ConnectedOutputChoices service={service} />
            <PreviewControls service={service} focus={focus} />
        </Gtk.Box>
    );
};
