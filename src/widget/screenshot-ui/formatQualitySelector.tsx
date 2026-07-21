import Gtk from 'gi://Gtk?version=4.0';
import {createBinding} from 'gnim';
import Screenshot from '#/lib/services/capture/screenshot';
import {getScreenCaptureSettings} from '#/lib/settings/screenCapture';

export default () => {
    const ss = Screenshot.get_default();
    const captureSettings = getScreenCaptureSettings();

    const QualityButton = ({
        label,
        value,
    }: {
        label: string;
        value: number;
    }) => {
        const active = createBinding(ss.prefs, 'recordingQuality').as(
            q => q === value
        );
        return (
            <Gtk.ToggleButton
                active={active}
                onToggled={btn => {
                    if (btn.active) {
                        ss.prefs.recordingQuality = value;
                        captureSettings.setRecordingQuality(value);
                    }
                }}
            >
                <Gtk.Label label={label} />
            </Gtk.ToggleButton>
        );
    };

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
            {/* Format toggle */}
            <Gtk.Box spacing={4} valign={Gtk.Align.CENTER}>
                <Gtk.Label label="Format:" />
                <Gtk.Box spacing={0} cssClasses={['linked']}>
                    <Gtk.ToggleButton
                        active={captureSettings.recordingFormat() === 0}
                        onToggled={btn => {
                            if (btn.active)
                                captureSettings.setRecordingFormat(0);
                        }}
                    >
                        <Gtk.Label label="MP4" />
                    </Gtk.ToggleButton>
                    <Gtk.ToggleButton
                        active={captureSettings.recordingFormat() === 1}
                        onToggled={btn => {
                            if (btn.active)
                                captureSettings.setRecordingFormat(1);
                        }}
                    >
                        <Gtk.Label label="WebM" />
                    </Gtk.ToggleButton>
                </Gtk.Box>
            </Gtk.Box>

            {/* Quality selector */}
            <Gtk.Box spacing={4} valign={Gtk.Align.CENTER}>
                <Gtk.Label label="Quality:" />
                <Gtk.Box spacing={0} cssClasses={['linked']}>
                    <QualityButton label="Low" value={0} />
                    <QualityButton label="Med" value={1} />
                    <QualityButton label="High" value={2} />
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Box>
    );
};
