import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import Screenshot from '@shade/services/capture/screenshot';
import {type Accessor, bind} from 'gnim';

function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `0:${s.toString().padStart(2, '0')}`;
}

export default ({vertical}: {vertical: Accessor<boolean>}) => {
    const screenshot = Screenshot.get_default();
    const duration = bind(screenshot, 'recordingElapsed').as((sec) =>
        formatDuration(sec ?? 0)
    );

    return (
        <Gtk.Button
            visible={bind(screenshot, 'recording')}
            onClicked={() => screenshot.stopRecording()}
            cssClasses={vertical.as((v) => (v ? ['flat', 'bar-vertical-content-button'] : ['flat']))}
            tooltipText={duration.as((value) => `Click to stop recording (${value})`)}
        >
            <Gtk.Box
                spacing={4}
                orientation={vertical.as((v) =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
            >
                <Gtk.Image iconName="media-record-symbolic" />
                <Gtk.Label
                    label={duration}
                    maxWidthChars={vertical.as((v) => (v ? 4 : 10))}
                    ellipsize={Pango.EllipsizeMode.END}
                    tooltipText={duration}
                />
            </Gtk.Box>
        </Gtk.Button>
    );
};
