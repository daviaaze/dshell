import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {getApp} from '@shade/services/appHandle';
import Screenshot from '@shade/services/capture/screenshot';
import {getHyprland} from '@shade/services/hyprland';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {bind} from 'gnim';

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
    const hyprland = getHyprland();
    if (!hyprland) return null;

    const elapsedLabel = bind(ss, 'recordingElapsed').as((sec) => formatDuration(sec ?? 0));

    return (
        <Astal.Window
            name={'recording-bar'}
            application={getApp()}
            layer={Astal.Layer.OVERLAY}
            marginTop={12}
            marginBottom={12}
            marginStart={12}
            marginEnd={12}
            anchor={Astal.WindowAnchor.BOTTOM | Astal.WindowAnchor.RIGHT}
            monitor={bind(hyprland, 'focused-monitor').as(monitorIndexFromHyprland)}
            visible={bind(ss, 'recording')}
            css={'background-color: transparent;'}
        >
            <Gtk.Box cssClasses={['card', 'background']} spacing={8} css={'box-shadow: none; padding: 6px 12px;'}>
                {/* Red recording dot */}
                <Gtk.Image iconName="media-record-symbolic" cssClasses={['error']} pixelSize={16} />

                {/* "REC" label */}
                <Gtk.Label label="REC" cssClasses={['error', 'heading']} />

                {/* Separator */}
                <Gtk.Separator orientation={Gtk.Orientation.VERTICAL} />

                {/* Elapsed time */}
                <Gtk.Label label={elapsedLabel} cssClasses={['monospace']} />

                {/* Audio indicator */}
                <Gtk.Image
                    visible={bind(ss.prefs, 'audio')}
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
                    <Gtk.Image iconName="media-playback-stop-symbolic" pixelSize={12} />
                </Gtk.Button>
            </Gtk.Box>
        </Astal.Window>
    );
};
