import Screenshot from '#/lib/services/capture/screenshot';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding} from 'gnim';
import type {QuickButton} from '#/widget/quicksettings/button-grid/quickButton';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';
import {LinkedBox} from '#/widget/common/linkedBox';
import {getScreenCaptureSettings} from '#/lib/settings/screenCapture';

export default (): QuickButton => {
    const screenshot = Screenshot.get_default();
    const captureSettings = getScreenCaptureSettings();

    // Dismiss the popover and run `fn` shortly after, so the selector/overlay
    // that follows gets a clean input grab instead of fighting the popover.
    const dismissAnd = (fn: () => void, delay = 150) =>
        (btn: Gtk.Button) => {
            const root = btn.get_root();
            if (root instanceof Gtk.Popover) root.popdown();
            setTimeout(fn, delay);
        };

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                cssClasses={['popover-padded']}
            >
                {/* Screenshot section */}
                <Gtk.Label
                    label="Screenshot"
                    halign={Gtk.Align.START}
                    cssClasses={['title-4']}
                />
                <LinkedBox>
                    <Gtk.Button onClicked={() => screenshot.screenshot(true)}>
                        <Adw.ButtonContent
                            iconName="camera-photo-symbolic"
                            label="Fullscreen"
                        />
                    </Gtk.Button>
                    <Gtk.Button onClicked={dismissAnd(() => screenshot.screenshot(false))}>
                        <Adw.ButtonContent
                            iconName="selection-mode-symbolic"
                            label="Area"
                        />
                    </Gtk.Button>
                </LinkedBox>

                <Gtk.Separator />

                {/* Recording section */}
                <Gtk.Label
                    label="Recording"
                    halign={Gtk.Align.START}
                    cssClasses={['title-4']}
                />
                <LinkedBox>
                    <Gtk.Button onClicked={() => screenshot.toggleRecording()}>
                        <Adw.ButtonContent
                            iconName="camera-video-symbolic"
                            label="Fullscreen"
                        />
                    </Gtk.Button>
                    <Gtk.Button onClicked={dismissAnd(() => screenshot.recordArea())}>
                        <Adw.ButtonContent
                            iconName="selection-mode-symbolic"
                            label="Area"
                        />
                    </Gtk.Button>
                    <Gtk.Button
                        onClicked={dismissAnd(() => screenshot.recordOutputVisual())}
                    >
                        <Adw.ButtonContent
                            iconName="video-display-symbolic"
                            label="Output"
                        />
                    </Gtk.Button>
                    <Gtk.Button
                        onClicked={dismissAnd(() => screenshot.recordWindowVisual())}
                    >
                        <Adw.ButtonContent
                            iconName="focus-windows-symbolic"
                            label="Window"
                        />
                    </Gtk.Button>
                </LinkedBox>

                <Gtk.Separator />

                {/* Audio + recording format toggles */}
                <Gtk.Box
                    spacing={12}
                    orientation={Gtk.Orientation.HORIZONTAL}
                    marginStart={4}
                >
                    <Gtk.CheckButton
                        active={createBinding(screenshot.prefs, 'audio')}
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

                <Gtk.Separator />

                {/* Virtual monitor: headless output for OBS/camera capture.
                     Reads resolution/fps from gschema; toggles create/remove. */}
                <Gtk.Button
                    onClicked={() => {
                        if (screenshot.virtualMonitors.length > 0) {
                            screenshot.removeVirtualMonitors();
                        } else {
                            // eslint-disable-next-line sonarjs/void-use
                            void screenshot.createVirtualMonitor(
                                captureSettings.virtualMonitorResolution(),
                                captureSettings.virtualMonitorFps()
                            );
                        }
                    }}
                >
                    <Adw.ButtonContent
                        iconName={createBinding(
                            screenshot,
                            'virtualMonitorActive'
                        ).as(active =>
                            active
                                ? 'user-trash-symbolic'
                                : 'video-display-symbolic'
                        )}
                        label={createBinding(
                            screenshot,
                            'virtualMonitorActive'
                        ).as(active => (active ? 'Remove VM' : 'Add VM'))}
                    />
                </Gtk.Button>
            </Gtk.Box>
        </Gtk.Popover>
    ) as Gtk.Popover;

    return {
        widget: (
            <QuickToggleButton
                icon={createBinding(screenshot, 'recording').as(rec =>
                    rec ? 'media-playback-stop-symbolic' : 'camera-video-symbolic'
                )}
                label={createBinding(screenshot, 'recording').as(rec =>
                    rec ? 'Stop' : 'Record'
                )}
                onClick={() => screenshot.toggleRecording()}
                popover={popover}
            />
        ) as Gtk.Widget,
    };
};
