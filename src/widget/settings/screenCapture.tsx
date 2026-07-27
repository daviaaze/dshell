import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {useSettings} from '#/lib/settings';

const VIRTUAL_MONITOR_FPS_MIN = 1;
const VIRTUAL_MONITOR_FPS_MAX = 144;

export default () => {
    const settings = useSettings().screenCapture;

    return (
        <>
            <Adw.PreferencesGroup
                title={'Recording'}
                description={'Screen recording backend and format'}
            >
                <Adw.ActionRow title={'Backend'}>
                    <Adw.ToggleGroup
                        cssClasses={['round']}
                        valign={Gtk.Align.CENTER}
                        onNotifyActiveName={self =>
                            settings.setRecorderBackend(Number(self.activeName))
                        }
                        ref={self => {
                            const v = settings.recorderBackend.peek();
                            self.activeName = String(v ?? 2);
                            settings.recorderBackend.subscribe(() => {
                                self.activeName = String(
                                    settings.recorderBackend.peek()
                                );
                            });
                        }}
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
                    </Adw.ToggleGroup>
                </Adw.ActionRow>

                <Adw.ActionRow title={'Container Format'}>
                    <Adw.ToggleGroup
                        cssClasses={['round']}
                        valign={Gtk.Align.CENTER}
                        onNotifyActiveName={self =>
                            settings.setRecordingFormat(Number(self.activeName))
                        }
                        ref={self => {
                            const v = settings.recordingFormat.peek();
                            self.activeName = String(v ?? 0);
                            settings.recordingFormat.subscribe(() => {
                                self.activeName = String(
                                    settings.recordingFormat.peek()
                                );
                            });
                        }}
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
                    </Adw.ToggleGroup>
                </Adw.ActionRow>

                <Adw.ActionRow title={'Quality'}>
                    <Adw.ToggleGroup
                        cssClasses={['round']}
                        valign={Gtk.Align.CENTER}
                        onNotifyActiveName={self =>
                            settings.setRecordingQuality(
                                Number(self.activeName)
                            )
                        }
                        ref={self => {
                            const v = settings.recordingQuality.peek();
                            self.activeName = String(v ?? 1);
                            settings.recordingQuality.subscribe(() => {
                                self.activeName = String(
                                    settings.recordingQuality.peek()
                                );
                            });
                        }}
                    >
                        <Adw.Toggle name={'0'} label={'Low'} />
                        <Adw.Toggle name={'1'} label={'Medium'} />
                        <Adw.Toggle name={'2'} label={'High'} />
                    </Adw.ToggleGroup>
                </Adw.ActionRow>

                <Adw.SwitchRow
                    title={'Record Audio'}
                    subtitle={'Capture system audio by default'}
                    active={settings.recordAudio}
                    onNotifyActive={self =>
                        settings.setRecordAudio(self.active)
                    }
                />
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup
                title={'Screenshot'}
                description={'Screenshot image format'}
            >
                <Adw.ActionRow title={'Image Format'}>
                    <Adw.ToggleGroup
                        cssClasses={['round']}
                        valign={Gtk.Align.CENTER}
                        onNotifyActiveName={self =>
                            settings.setScreenshotFormat(
                                Number(self.activeName)
                            )
                        }
                        ref={self => {
                            const v = settings.screenshotFormat.peek();
                            self.activeName = String(v ?? 0);
                            settings.screenshotFormat.subscribe(() => {
                                self.activeName = String(
                                    settings.screenshotFormat.peek()
                                );
                            });
                        }}
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
                    </Adw.ToggleGroup>
                </Adw.ActionRow>
            </Adw.PreferencesGroup>

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
                    onNotifyValue={self =>
                        settings.setVirtualMonitorFps(self.value)
                    }
                />
            </Adw.PreferencesGroup>
        </>
    );
};
