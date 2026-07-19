// @ts-nocheck — pre-existing GI type gaps; see tsconfig.json for strict mode settings
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding} from 'gnim';
import Screenshot from '#/lib/services/capture/screenshot';

function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0
        ? `${m}:${s.toString().padStart(2, '0')}`
        : `0:${s.toString().padStart(2, '0')}`;
}

export default () => {
    const screenshot = Screenshot.get_default();

    return (
        <Gtk.Button
            visible={createBinding(screenshot, 'recording')}
            onClicked={() => screenshot.stopRecording()}
            cssClasses={['flat']}
            tooltipText="Click to stop recording"
        >
            <Adw.ButtonContent
                iconName="media-record-symbolic"
                label={createBinding(screenshot, 'recording-elapsed').as(sec =>
                    formatDuration(sec ?? 0)
                )}
            />
        </Gtk.Button>
    );
};
