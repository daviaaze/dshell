import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Screenshot from '@shade/services/capture/screenshot';
import {getScreenCaptureSettings} from '@shade/services/settings/screenCapture';
import {bind} from 'gnim';
import {LinkedBox} from '../../common/linkedBox';
import {QuickToggleButton} from '../../common/quickToggleButton';
import type {QuickButton} from './quickButton';

// Dismiss the popover and run `fn` shortly after, so the selector/overlay
// that follows gets a clean input grab instead of fighting the popover.
const dismissAnd =
    (fn: () => void, delay = 150) =>
    (btn: Gtk.Button) => {
        const root = btn.get_root();
        if (root instanceof Gtk.Popover) root.popdown();
        setTimeout(fn, delay);
    };

/** Fullscreen + area screenshot buttons. */
function ScreenshotSection({ss}: {ss: Screenshot}) {
    return (
        <>
            <Gtk.Label label="Screenshot" halign={Gtk.Align.START} cssClasses={['title-4']} />
            <LinkedBox>
                <Gtk.Button onClicked={() => ss.screenshot(true)}>
                    <Adw.ButtonContent iconName="camera-photo-symbolic" label="Fullscreen" />
                </Gtk.Button>
                <Gtk.Button onClicked={dismissAnd(() => ss.screenshot(false))}>
                    <Adw.ButtonContent iconName="selection-mode-symbolic" label="Area" />
                </Gtk.Button>
            </LinkedBox>
        </>
    );
}

/** Recording mode buttons: fullscreen, area, output, window. */
function RecordingSection({ss}: {ss: Screenshot}) {
    return (
        <>
            <Gtk.Label label="Recording" halign={Gtk.Align.START} cssClasses={['title-4']} />
            <LinkedBox>
                <Gtk.Button onClicked={() => ss.toggleRecording()}>
                    <Adw.ButtonContent iconName="camera-video-symbolic" label="Fullscreen" />
                </Gtk.Button>
                <Gtk.Button onClicked={dismissAnd(() => ss.recordArea())}>
                    <Adw.ButtonContent iconName="selection-mode-symbolic" label="Area" />
                </Gtk.Button>
                <Gtk.Button onClicked={dismissAnd(() => ss.recordOutputVisual())}>
                    <Adw.ButtonContent iconName="video-display-symbolic" label="Output" />
                </Gtk.Button>
                <Gtk.Button onClicked={dismissAnd(() => ss.recordWindowVisual())}>
                    <Adw.ButtonContent iconName="focus-windows-symbolic" label="Window" />
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
                active={bind(screenshot.prefs, 'audio')}
                onNotifyActive={({active}) => {
                    screenshot.prefs.audio = active;
                }}
            />
            <Gtk.Label label="Record Audio" />

            {/* WebM (VP9). Unchecked = MP4 (H.264), the default. */}
            <Gtk.CheckButton
                active={captureSettings.recordingFormat() === 1}
                onNotifyActive={({active}) => {
                    captureSettings.setRecordingFormat(active ? 1 : 0);
                }}
            />
            <Gtk.Label label="WebM" />
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
                    active ? 'Remove VM' : 'Add VM'
                )}
            />
        </Gtk.Button>
    );
}

export default (): QuickButton => {
    const screenshot = Screenshot.get_default();
    const captureSettings = getScreenCaptureSettings();

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                cssClasses={['popover-padded']}
            >
                <ScreenshotSection ss={screenshot} />
                <Gtk.Separator />
                <RecordingSection ss={screenshot} />
                <Gtk.Separator />
                <PrefsSection screenshot={screenshot} captureSettings={captureSettings} />
                <Gtk.Separator />
                <VirtualMonitorButton screenshot={screenshot} captureSettings={captureSettings} />
            </Gtk.Box>
        </Gtk.Popover>
    );

    return {
        widget: (
            <QuickToggleButton
                icon={bind(screenshot, 'recording').as((rec) =>
                    rec ? 'media-playback-stop-symbolic' : 'camera-video-symbolic'
                )}
                label={bind(screenshot, 'recording').as((rec) => (rec ? 'Stop' : 'Record'))}
                onClick={() => screenshot.toggleRecording()}
                popover={popover}
            />
        ),
    };
};
