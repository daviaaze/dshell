import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {screenCaptureSettings} from '@shade/services/settings/screenCapture.gschema';
import {type Accessor, onCleanup} from 'gnim';

const VIRTUAL_MONITOR_FPS_MIN = 1;
const VIRTUAL_MONITOR_FPS_MAX = 144;

type Settings = ReturnType<typeof screenCaptureSettings>;

/** ActionRow with a round ToggleGroup bound to an int or string enum setting. */
function EnumToggleRow({
    title,
    value,
    fallback,
    setter,
    toggles,
}: {
    title: string;
    value: Accessor<number | string>;
    fallback: number | string;
    setter: (v: string | number) => void;
    toggles: readonly {name: string; label: string; iconName?: string}[];
}) {
    return (
        <Adw.ActionRow title={title}>
            <Adw.ToggleGroup
                cssClasses={['round']}
                valign={Gtk.Align.CENTER}
                ref={(self) => {
                    for (const toggle of toggles) self.add(new Adw.Toggle(toggle));
                    self.activeName = String(value.peek() ?? fallback);
                    const changed = self.connect('notify::active-name', () => {
                        const name = String(self.activeName ?? '');
                        if (name !== String(value.peek())) setter(Number(name) || name);
                    });
                    const unsubscribe = value.subscribe(() => {
                        self.activeName = String(value.peek());
                    });
                    onCleanup(() => {
                        unsubscribe();
                        self.disconnect(changed);
                        self.remove_all();
                    });
                }}
            />
        </Adw.ActionRow>
    );
}

/** Recording group: backend, container, quality, audio. */
function RecordingGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup
            title={'Gravação de tela'}
            description={'Backend e formato da gravação.'}
        >
            <EnumToggleRow
                title={'Backend'}
                value={settings.recorderBackend}
                fallback={2}
                setter={(v) => settings.setRecorderBackend(Number(v))}
                toggles={[
                    {name: '0', label: 'wl-screenrec', iconName: 'media-record-symbolic'},
                    {name: '1', label: 'wf-recorder', iconName: 'media-record-symbolic'},
                    {name: '2', label: 'Automático', iconName: 'emblem-system-symbolic'},
                ]}
            />

            <EnumToggleRow
                title={'Formato'}
                value={settings.recordingFormat}
                fallback={0}
                setter={(v) => settings.setRecordingFormat(Number(v))}
                toggles={[
                    {name: '0', label: 'MP4', iconName: 'video-x-generic-symbolic'},
                    {name: '1', label: 'WebM', iconName: 'video-x-generic-symbolic'},
                ]}
            />

            <EnumToggleRow
                title={'Qualidade'}
                value={settings.recordingQuality}
                fallback={1}
                setter={(v) => settings.setRecordingQuality(Number(v))}
                toggles={[
                    {name: '0', label: 'Baixa'},
                    {name: '1', label: 'Média'},
                    {name: '2', label: 'Alta'},
                ]}
            />

            <Adw.SwitchRow
                title={'Gravar áudio do sistema'}
                subtitle={'Incluir áudio do sistema por padrão.'}
                active={settings.recordAudio}
                onNotifyActive={(self) => settings.setRecordAudio(self.active)}
            />
        </Adw.PreferencesGroup>
    );
}

/** Screenshot group: PNG/JPEG format. */
function ScreenshotGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup title={'Imagem'} description={'Formato das capturas de imagem.'}>
            <EnumToggleRow
                title={'Formato de imagem'}
                value={settings.screenshotFormat}
                fallback={0}
                setter={(v) => settings.setScreenshotFormat(Number(v))}
                toggles={[
                    {name: '0', label: 'PNG', iconName: 'image-x-generic-symbolic'},
                    {name: '1', label: 'JPEG', iconName: 'image-x-generic-symbolic'},
                ]}
            />
        </Adw.PreferencesGroup>
    );
}

/** Boundary group: show/hide red recording border plus color picker. */
function BoundaryGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup
            title={'Áudio e indicação'}
            description={'Indicador visual da área de gravação.'}
        >
            <Adw.SwitchRow
                title={'Mostrar limite da área gravada'}
                subtitle={'Borda ao redor da área gravada ou compartilhada.'}
                active={settings.showRecordingBoundary}
                onNotifyActive={(self) => settings.setShowRecordingBoundary(self.active)}
            />
            <Adw.ActionRow title={'Cor do limite'} subtitle={settings.recordingBoundaryColor}>
                <Gtk.ColorDialogButton
                    valign={Gtk.Align.CENTER}
                    dialog={new Gtk.ColorDialog()}
                    ref={(self) => {
                        const c = new Gdk.RGBA();
                        c.parse(settings.recordingBoundaryColor());
                        self.rgba = c;
                    }}
                    onNotifyRgba={(self) => {
                        settings.setRecordingBoundaryColor(self.rgba.to_string());
                    }}
                />
            </Adw.ActionRow>
        </Adw.PreferencesGroup>
    );
}

/** Overlay group: freeze screen + preview thumbnails. */
function OverlayGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup title={'Seleção de área'} description={'Comportamento da seleção de captura.'}>
            <EnumToggleRow
                title={'Motor de seleção'}
                value={settings.areaSelectionEngine}
                fallback={'overlay'}
                setter={(v) => settings.setAreaSelectionEngine(String(v))}
                toggles={[
                    {name: 'overlay', label: 'Painel', iconName: 'input-mouse-symbolic'},
                    {name: 'slurp', label: 'slurp', iconName: 'input-keyboard-symbolic'},
                ]}
            />
            <Adw.SwitchRow
                title={'Congelar tela ao abrir seleção'}
                subtitle={'Pausar a imagem durante a seleção de captura.'}
                active={settings.overlayFreezeEnabled}
                onNotifyActive={(self) => settings.setOverlayFreezeEnabled(self.active)}
            />
            <Adw.SwitchRow
                title={'Mostrar previews do alvo'}
                subtitle={'Exibir prévias na seleção de captura.'}
                active={settings.previewThumbnailsEnabled}
                onNotifyActive={(self) => settings.setPreviewThumbnailsEnabled(self.active)}
            />
        </Adw.PreferencesGroup>
    );
}

/** Virtual monitor group: default resolution and refresh rate. */
function VirtualMonitorGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup
            title={'Monitor virtual'}
            description={'Resolução e taxa de atualização padrão.'}
        >
            <Adw.EntryRow
                title={'Resolução'}
                showApplyButton
                text={settings.virtualMonitorResolution}
                onApply={(self) => settings.setVirtualMonitorResolution(self.text)}
            />
            <Adw.SpinRow
                ref={(self) => {
                    self.adjustment = new Gtk.Adjustment({
                        lower: VIRTUAL_MONITOR_FPS_MIN,
                        upper: VIRTUAL_MONITOR_FPS_MAX,
                        stepIncrement: 1,
                        value: settings.virtualMonitorFps(),
                    });
                }}
                title={'Taxa de atualização'}
                subtitle={'Quadros por segundo (fps).'}
                onNotifyValue={(self) => settings.setVirtualMonitorFps(self.value)}
            />
        </Adw.PreferencesGroup>
    );
}

export default () => {
    const settings = screenCaptureSettings();

    return (
        <>
            <RecordingGroup settings={settings} />
            <ScreenshotGroup settings={settings} />
            <BoundaryGroup settings={settings} />
            <OverlayGroup settings={settings} />
            <VirtualMonitorGroup settings={settings} />
        </>
    );
};
