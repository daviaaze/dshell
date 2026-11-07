import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import LayoutService, {type OutputInfo} from '@shade/services/display/layouts';
import type {DisplayMode} from '@shade/services/display/modes';
import {bind, computed, For, onCleanup, With} from 'gnim';
import {QuickControlButton} from '../common/quickControlButton';

const SPACING = 12;

function modeLabel(mode: DisplayMode, outputs: OutputInfo[]) {
    const hasInternal = outputs.some((output) => /^eDP-/.test(output.name));
    const externalCount = outputs.length - (hasInternal ? 1 : 0);
    const name = {
        'internal-only': 'Somente interna',
        'external-only': 'Somente externa',
        extend: 'Estender',
        duplicate: 'Duplicar',
    }[mode];
    let count = outputs.length;
    if (mode === 'internal-only') count = Number(hasInternal);
    else if (mode === 'external-only') count = externalCount;
    return `${name} · ${count} ${count === 1 ? 'monitor' : 'monitores'}`;
}

function modeUnavailableReason(mode: DisplayMode, outputs: OutputInfo[]) {
    const hasInternal = outputs.some((output) => /^eDP-/.test(output.name));
    const hasExternal = outputs.some((output) => !/^eDP-/.test(output.name));
    if (mode === 'internal-only' && !hasInternal) return 'sem tela interna';
    if (mode === 'external-only') {
        if (!hasExternal) return 'sem tela externa';
        if (!hasInternal) return 'sem tela interna';
    }
    if ((mode === 'extend' || mode === 'duplicate') && outputs.length < 2)
        return 'conecte ao menos duas telas';
    return '';
}

function monitorStatus(monitor: OutputInfo, enabledCount: number) {
    const state = monitor.enabled ? 'Ativa' : 'Desativada';
    const mirror = monitor.mirror ? ` · Espelha ${monitor.mirror}` : '';
    const lastEnabled = monitor.enabled && enabledCount <= 1 ? ' · última tela ativa' : '';
    return `${state}${mirror}${lastEnabled}`;
}
function monitorActionLabel(monitor: OutputInfo, enabledCount: number) {
    if (monitor.enabled && enabledCount <= 1) return 'Ao menos uma tela deve permanecer ativa';
    if (monitor.enabled) return 'Desativar tela';
    return 'Ativar tela';
}

const DISPLAY_MODES: DisplayMode[] = ['internal-only', 'external-only', 'extend', 'duplicate'];

class DisplayFocusController {
    #service: LayoutService;
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

    constructor(service: LayoutService) {
        this.#service = service;
        this.#chooserSignal = service.connect('mode-chooser-requested', () => {
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
            const focusedChoice = [...this.#modeButtons].find(([, button]) => button.hasFocus);
            if (focusedChoice && !this.#service.availableDisplayModes.includes(focusedChoice[0])) {
                this.#scheduleFocus('mode');
            }
        }
    }

    #handleKey(keyval: number) {
        const modes = this.#service.availableDisplayModes as DisplayMode[];
        const focusedIndex = modes.findIndex((mode) => this.#modeButtons.get(mode)?.hasFocus);
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
            if (button.hasFocus) this.#chooserFocusPending = false;
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

function ModeChooser({service, focus}: {service: LayoutService; focus: DisplayFocusController}) {
    const modes = bind(service, 'availableDisplayModes');
    const displayMode = bind(service, 'displayMode');
    const outputs = bind(service, 'monitors');
    const emptyVisible = computed(() => modes().length === 0);
    return (
        <Adw.PreferencesGroup title="Modos rápidos">
            <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
                {DISPLAY_MODES.map((mode: DisplayMode) => (
                    <With value={modes.as((choices) => choices.includes(mode))}>
                        {(available) =>
                            available ? (
                                <Gtk.Button
                                    ref={(self) => focus.attachModeButton(mode, self)}
                                    cssClasses={displayMode.as((currentMode) =>
                                        currentMode === mode ? ['suggested-action'] : []
                                    )}
                                    tooltipText={
                                        mode === 'duplicate'
                                            ? 'Espelha todas as telas conectadas; diferenças de resolução podem redimensionar a imagem.'
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
                            ) : (
                                <Adw.ActionRow
                                    title={outputs.as((attached) => modeLabel(mode, attached))}
                                    subtitle={outputs.as(
                                        (attached) =>
                                            `Indisponível: ${modeUnavailableReason(mode, attached)}`
                                    )}
                                />
                            )
                        }
                    </With>
                ))}
                <Gtk.Label
                    ref={(self) => focus.attachEmptyLabel(self)}
                    label="Conecte uma tela para escolher um modo."
                    xalign={0}
                    focusable
                    visible={emptyVisible}
                    cssClasses={['caption']}
                />
            </Gtk.Box>
        </Adw.PreferencesGroup>
    );
}

function SavedLayoutChoices({service}: {service: LayoutService}) {
    const current = bind(service, 'current');
    const names = bind(service, 'names');
    return (
        <Adw.PreferencesGroup
            title="Layouts salvos"
            visible={names.as((items) => items.length > 0)}
        >
            <For each={names}>
                {(name: string) => (
                    <QuickControlButton
                        intent="action"
                        icon="video-display-symbolic"
                        domain={name}
                        value={current.as((currentName) =>
                            currentName === name ? 'Layout atual' : 'Perfil salvo'
                        )}
                        actionLabel="Pré-visualizar layout salvo"
                        onClick={() => {
                            const layout = service.get(name);
                            if (layout) void service.preview(layout).catch(() => undefined);
                        }}
                    />
                )}
            </For>
        </Adw.PreferencesGroup>
    );
}

function ConnectedOutputChoices({service}: {service: LayoutService}) {
    const outputs = bind(service, 'monitors');
    return (
        <Adw.PreferencesGroup title="Monitores" visible={outputs.as((items) => items.length > 0)}>
            <For each={outputs}>
                {(monitor: OutputInfo) => {
                    const enabledCount = computed(
                        () => outputs().filter((output) => output.enabled).length
                    );
                    const actionLabel = enabledCount.as((count) =>
                        monitorActionLabel(monitor, count)
                    );
                    return (
                        <Adw.ActionRow
                            title={monitor.description || monitor.name}
                            subtitle={enabledCount.as((count) => monitorStatus(monitor, count))}
                        >
                            <Gtk.Switch
                                slot="suffix"
                                valign={Gtk.Align.CENTER}
                                active={monitor.enabled}
                                sensitive={
                                    monitor.enabled ? enabledCount.as((count) => count > 1) : true
                                }
                                tooltipText={actionLabel}
                                onNotifyActive={(self) => {
                                    if (self.active === monitor.enabled) return;
                                    void service
                                        .setEnabled(monitor.name, self.active)
                                        .then((applied) => {
                                            if (!applied) self.active = monitor.enabled;
                                        })
                                        .catch(() => {
                                            self.active = monitor.enabled;
                                        });
                                }}
                            />
                        </Adw.ActionRow>
                    );
                }}
            </For>
        </Adw.PreferencesGroup>
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
                    label="As alterações serão revertidas em 15 segundos"
                    cssClasses={['caption']}
                    hexpand
                    xalign={0}
                />
                <Gtk.Button
                    label="Manter"
                    hexpand
                    onClicked={() => void service.confirm().catch(() => false)}
                />
                <Gtk.Button
                    ref={(self) => focus.attachRevertButton(self)}
                    label="Reverter"
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
    const focus = new DisplayFocusController(service);

    return (
        <Gtk.Box
            spacing={SPACING}
            orientation={Gtk.Orientation.VERTICAL}
            ref={(self) => focus.attachRoot(self)}
        >
            <Gtk.Label
                label="Escolha um modo, ajuste monitores ou pré-visualize um layout salvo."
                xalign={0}
                wrap
                cssClasses={['caption']}
            />
            <ModeChooser service={service} focus={focus} />
            <SavedLayoutChoices service={service} />
            <ConnectedOutputChoices service={service} />
            <PreviewControls service={service} focus={focus} />
        </Gtk.Box>
    );
};
