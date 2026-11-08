import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Screenshot from '@shade/services/capture/screenshot';
import {getScreenCaptureSettings} from '@shade/services/settings/screenCapture';
import {bind} from 'gnim';
import {LinkedBox} from '../../common/linkedBox';
import {QuickControlButton} from '../../common/quickControlButton';
import type {QuickDetailButton} from './quickButton';

// Run selector/overlay actions after navigation has yielded the input grab.
const dismissAnd =
    (fn: () => void, delay = 150) =>
    (_btn: Gtk.Button) => {
        setTimeout(fn, delay);
    };

/** Fullscreen + area screenshot buttons. */
function ScreenshotSection({ss}: {ss: Screenshot}) {
    return (
        <>
            <Gtk.Label label="Captura de tela" halign={Gtk.Align.START} cssClasses={['title-4']} />
            <LinkedBox>
                <Gtk.Button onClicked={() => ss.screenshot(true)}>
                    <Adw.ButtonContent iconName="camera-photo-symbolic" label="Tela cheia" />
                </Gtk.Button>
                <Gtk.Button onClicked={dismissAnd(() => ss.screenshot(false))}>
                    <Adw.ButtonContent iconName="selection-mode-symbolic" label="Área" />
                </Gtk.Button>
            </LinkedBox>
        </>
    );
}

/** Recording mode buttons: fullscreen, area, output, window. */
function RecordingSection({ss}: {ss: Screenshot}) {
    return (
        <>
            <Gtk.Label label="Gravação" halign={Gtk.Align.START} cssClasses={['title-4']} />
            <LinkedBox>
                <Gtk.Button onClicked={() => ss.toggleRecording()}>
                    <Adw.ButtonContent iconName="camera-video-symbolic" label="Tela cheia" />
                </Gtk.Button>
                <Gtk.Button onClicked={dismissAnd(() => ss.recordArea())}>
                    <Adw.ButtonContent iconName="selection-mode-symbolic" label="Área" />
                </Gtk.Button>
                <Gtk.Button onClicked={dismissAnd(() => ss.recordOutputVisual())}>
                    <Adw.ButtonContent iconName="video-display-symbolic" label="Monitor" />
                </Gtk.Button>
                <Gtk.Button onClicked={dismissAnd(() => ss.recordWindowVisual())}>
                    <Adw.ButtonContent iconName="focus-windows-symbolic" label="Janela" />
                </Gtk.Button>
            </LinkedBox>
        </>
    );
}

/** Record-audio checkbox and WebM/MP4 format toggle. */
function PrefsSection({
    screenshot,
    captureSettings,
}: {
    screenshot: Screenshot;
    captureSettings: ReturnType<typeof getScreenCaptureSettings>;
}) {
    return (
        <Gtk.Box spacing={12} orientation={Gtk.Orientation.HORIZONTAL} marginStart={4}>
            <Gtk.CheckButton
                label="Gravar áudio"
                active={bind(screenshot.prefs, 'audio')}
                onNotifyActive={({active}) => {
                    if (screenshot.prefs.audio !== active) screenshot.prefs.audio = active;
                }}
            />
            {/* WebM (VP9). Unchecked = MP4 (H.264), the default. */}
            <Gtk.CheckButton
                label="WebM"
                active={captureSettings.recordingFormat() === 1}
                onNotifyActive={({active}) => {
                    const format = active ? 1 : 0;
                    if (captureSettings.recordingFormat() !== format)
                        captureSettings.setRecordingFormat(format);
                }}
            />
        </Gtk.Box>
    );
}

/** Virtual monitor: headless output for OBS/camera capture.
 *  Reads resolution/fps from gschema; toggles create/remove. */
function VirtualMonitorButton({
    screenshot,
    captureSettings,
}: {
    screenshot: Screenshot;
    captureSettings: ReturnType<typeof getScreenCaptureSettings>;
}) {
    return (
        <Gtk.Button
            onClicked={() => {
                if (screenshot.virtualMonitors.length > 0) {
                    screenshot.removeVirtualMonitors();
                } else {
                    screenshot.createVirtualMonitor(
                        captureSettings.virtualMonitorResolution(),
                        captureSettings.virtualMonitorFps()
                    );
                }
            }}
        >
            <Adw.ButtonContent
                iconName={bind(screenshot, 'virtualMonitorActive').as((active) =>
                    active ? 'user-trash-symbolic' : 'video-display-symbolic'
                )}
                label={bind(screenshot, 'virtualMonitorActive').as((active) =>
                    active ? 'Remover monitor virtual' : 'Adicionar monitor virtual'
                )}
            />
        </Gtk.Button>
    );
}

export default (onOpen: (self: Gtk.Button) => void): QuickDetailButton => {
    const screenshot = Screenshot.get_default();
    const captureSettings = getScreenCaptureSettings();

    const detail = (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={8}
            marginTop={8}
            marginBottom={8}
            marginStart={8}
            marginEnd={8}
        >
            <ScreenshotSection ss={screenshot} />
            <Gtk.Separator />
            <RecordingSection ss={screenshot} />
            <Gtk.Separator />
            <PrefsSection screenshot={screenshot} captureSettings={captureSettings} />
            <Gtk.Separator />
            <VirtualMonitorButton screenshot={screenshot} captureSettings={captureSettings} />
        </Gtk.Box>
    );

    return {
        detail,
        widget: (
            <QuickControlButton
                intent="toggle"
                active={bind(screenshot, 'recording')}
                domain="Captura de tela"
                icon={bind(screenshot, 'recording').as((rec) =>
                    rec ? 'media-playback-stop-symbolic' : 'camera-video-symbolic'
                )}
                value={bind(screenshot, 'recording').as((rec) =>
                    rec ? 'Gravando' : 'Sem gravação'
                )}
                actionLabel="Iniciar ou parar gravação em tela cheia"
                onClick={() => screenshot.toggleRecording()}
                detail={{label: 'Opções de captura', onOpen}}
            />
        ),
    };
};
