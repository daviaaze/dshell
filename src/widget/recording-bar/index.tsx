import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import {createBinding} from 'gnim';
import {app} from '#/App';
import Screenshot from '#/lib/screenshot';

function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const h = Math.floor(m / 60);
    if (h > 0) {
        return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

export default () => {
    const ss = Screenshot.get_default();
    const hyprland = AstalHyprland.get_default();

    const elapsedLabel = createBinding(ss, 'recording-elapsed').as(sec =>
        formatDuration(sec ?? 0)
    );

    return (
        <Astal.Window
            name={'recording-bar'}
            application={app}
            layer={Astal.Layer.OVERLAY}
            margin={12}
            anchor={Astal.WindowAnchor.BOTTOM | Astal.WindowAnchor.RIGHT}
            monitor={createBinding(hyprland, 'focusedMonitor').as(m => m.id)}
            visible={createBinding(ss, 'recording')}
            css={'background-color: transparent;'}
        >
            <Gtk.Box
                cssClasses={['card', 'frame', 'background']}
                spacing={8}
                css={'padding: 6px 12px;'}
            >
                {/* Red recording dot */}
                <Gtk.Image
                    iconName="media-record-symbolic"
                    css={'color: #FF0000;'}
                    pixelSize={16}
                />

                {/* "REC" label */}
                <Gtk.Label
                    label="REC"
                    css={'color: #FF0000; font-weight: bold; font-size: 13px;'}
                />

                {/* Separator */}
                <Gtk.Separator orientation={Gtk.Orientation.VERTICAL} />

                {/* Elapsed time */}
                <Gtk.Label
                    label={elapsedLabel}
                    css={'font-family: monospace; font-size: 13px;'}
                />

                {/* Audio indicator */}
                <Gtk.Image
                    visible={createBinding(ss, 'audio')}
                    iconName="audio-input-microphone-symbolic"
                    pixelSize={14}
                />

                {/* Separator */}
                <Gtk.Separator orientation={Gtk.Orientation.VERTICAL} />

                {/* Stop button */}
                <Gtk.Button
                    onClicked={() => ss.stopRecording()}
                    cssClasses={['circular', 'destructive-action']}
                    css={'min-width: 24px; min-height: 24px; padding: 0;'}
                    tooltipText="Stop recording"
                >
                    <Gtk.Image
                        iconName="media-playback-stop-symbolic"
                        pixelSize={12}
                    />
                </Gtk.Button>
            </Gtk.Box>
        </Astal.Window>
    );
};
