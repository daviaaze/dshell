import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, JSX, onCleanup} from 'gnim';
import {screenCaptureSettings} from '@shade/services/settings/screenCapture.gschema';

const VIRTUAL_MONITOR_FPS_MIN = 1;
const VIRTUAL_MONITOR_FPS_MAX = 144;

type Settings = ReturnType<typeof screenCaptureSettings>;

/** ActionRow with a round ToggleGroup bound to an int enum setting. */
function EnumToggleRow({
    title,
    value,
    fallback,
    setter,
    children,
}: {
    title: string;
    value: Accessor<number>;
    fallback: number;
    setter: (v: number) => void;
    children?: JSX.Element | JSX.Element[];
}) {
    return (
        <Adw.ActionRow title={title}>
            <Adw.ToggleGroup
                cssClasses={['round']}
                valign={Gtk.Align.CENTER}
                onNotifyActiveName={self => setter(Number(self.activeName))}
                ref={self => {
                    self.activeName = String(value.peek() ?? fallback);
                    onCleanup(
                        value.subscribe(() => {
                            self.activeName = String(value.peek());
                        })
                    );
                }}
            >
                {children}
            </Adw.ToggleGroup>
        </Adw.ActionRow>
    );
}

/** Recording group: backend, container, quality, audio. */
function RecordingGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup
            title={'Recording'}
            description={'Screen recording backend and format'}
        >
            <EnumToggleRow
                title={'Backend'}
                value={settings.recorderBackend}
                fallback={2}
                setter={v => settings.setRecorderBackend(v)}
            >
                <Adw.Toggle
                    name={'0'}
                    label={'wl-screenrec'}
                    iconName={'media-record-symbolic'}
                />
                <Adw.Toggle
                    name={'1'}
                    label={'wf-recorder'}
                    iconName={'media-record-symbolic'}
                />
                <Adw.Toggle
                    name={'2'}
                    label={'Auto'}
                    iconName={'emblem-system-symbolic'}
                />
            </EnumToggleRow>

            <EnumToggleRow
                title={'Container Format'}
                value={settings.recordingFormat}
                fallback={0}
                setter={v => settings.setRecordingFormat(v)}
            >
                <Adw.Toggle
                    name={'0'}
                    label={'MP4'}
                    iconName={'video-x-generic-symbolic'}
                />
                <Adw.Toggle
                    name={'1'}
                    label={'WebM'}
                    iconName={'video-x-generic-symbolic'}
                />
            </EnumToggleRow>

            <EnumToggleRow
                title={'Quality'}
                value={settings.recordingQuality}
                fallback={1}
                setter={v => settings.setRecordingQuality(v)}
            >
                <Adw.Toggle name={'0'} label={'Low'} />
                <Adw.Toggle name={'1'} label={'Medium'} />
                <Adw.Toggle name={'2'} label={'High'} />
            </EnumToggleRow>

            <Adw.SwitchRow
                title={'Record Audio'}
                subtitle={'Capture system audio by default'}
                active={settings.recordAudio}
                onNotifyActive={self => settings.setRecordAudio(self.active)}
            />
        </Adw.PreferencesGroup>
    );
}

/** Screenshot group: PNG/JPEG format. */
function ScreenshotGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup
            title={'Screenshot'}
            description={'Screenshot image format'}
        >
            <EnumToggleRow
                title={'Image Format'}
                value={settings.screenshotFormat}
                fallback={0}
                setter={v => settings.setScreenshotFormat(v)}
            >
                <Adw.Toggle
                    name={'0'}
                    label={'PNG'}
                    iconName={'image-x-generic-symbolic'}
                />
                <Adw.Toggle
                    name={'1'}
                    label={'JPEG'}
                    iconName={'image-x-generic-symbolic'}
                />
            </EnumToggleRow>
        </Adw.PreferencesGroup>
    );
}

/** Boundary group: show/hide red recording border plus color picker. */
function BoundaryGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup
            title={'Recording Boundary'}
            description={'Visual indicator for active recordings'}
        >
            <Adw.SwitchRow
                title={'Show Recording Boundary'}
                subtitle={'Red border around recorded/shared area'}
                active={settings.showRecordingBoundary}
                onNotifyActive={self =>
                    settings.setShowRecordingBoundary(self.active)
                }
            />
            <Adw.ActionRow
                title={'Boundary Color'}
                subtitle={settings.recordingBoundaryColor}
            >
                <Gtk.ColorDialogButton
                    valign={Gtk.Align.CENTER}
                    dialog={new Gtk.ColorDialog()}
                    ref={self => {
                        const c = new Gdk.RGBA();
                        c.parse(settings.recordingBoundaryColor());
                        self.rgba = c;
                    }}
                    onNotifyRgba={self => {
                        settings.setRecordingBoundaryColor(
                            self.rgba.to_string()
                        );
                    }}
                />
            </Adw.ActionRow>
        </Adw.PreferencesGroup>
    );
}

/** Overlay group: freeze screen + preview thumbnails. */
function OverlayGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup
            title={'Overlay'}
            description={'Capture overlay behavior'}
        >
            <Adw.SwitchRow
                title={'Freeze Screen'}
                subtitle={'Pause screen when opening capture overlay'}
                active={settings.overlayFreezeEnabled}
                onNotifyActive={self =>
                    settings.setOverlayFreezeEnabled(self.active)
                }
            />
            <Adw.SwitchRow
                title={'Preview Thumbnails'}
                subtitle={'Show live previews in capture overlay'}
                active={settings.previewThumbnailsEnabled}
                onNotifyActive={self =>
                    settings.setPreviewThumbnailsEnabled(self.active)
                }
            />
        </Adw.PreferencesGroup>
    );
}

/** Virtual monitor group: default resolution and refresh rate. */
function VirtualMonitorGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup
            title={'Virtual Monitor'}
            description={'Default resolution and refresh rate'}
        >
            <Adw.EntryRow
                title={'Resolution'}
                showApplyButton
                text={settings.virtualMonitorResolution}
                onApply={self =>
                    settings.setVirtualMonitorResolution(self.text)
                }
            />
            <Adw.SpinRow
                ref={self => {
                    self.adjustment = new Gtk.Adjustment({
                        lower: VIRTUAL_MONITOR_FPS_MIN,
                        upper: VIRTUAL_MONITOR_FPS_MAX,
                        stepIncrement: 1,
                        value: settings.virtualMonitorFps(),
                    });
                }}
                title={'Refresh Rate'}
                subtitle={'Frames per second'}
                onNotifyValue={self => settings.setVirtualMonitorFps(self.value)}
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