import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import {getApp} from '@shade/services/appHandle';
import Screenshot from '@shade/services/capture/screenshot';
import {getHyprland} from '@shade/services/hyprland';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {bind, computed} from 'gnim';

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
    const recording = bind(ss, 'recording');
    const captureBusy = bind(ss, 'captureBusy');
    const captureResult = bind(ss, 'captureResult');
    const captureError = bind(ss, 'captureError');
    const captureKind = bind(ss, 'captureKind');
    const feedbackVisible = computed(() => {
        const active = recording();
        const busy = captureBusy();
        const result = captureResult();
        const error = captureError();
        return !!active || !!busy || !!result || !!error;
    });

    return (
        <Astal.Window
            name={'recording-bar'}
            application={getApp()}
            namespace={'shade-recording'}
            layer={Astal.Layer.OVERLAY}
            margin={4}
            anchor={Astal.WindowAnchor.BOTTOM | Astal.WindowAnchor.RIGHT}
            monitor={bind(hyprland, 'focused-monitor').as(monitorIndexFromHyprland)}
            visible={feedbackVisible}
            keymode={Astal.Keymode.ON_DEMAND}
            css={'background-color: transparent;'}
        >
            <Adw.Clamp maximumSize={560} tighteningThreshold={420}>
            <Gtk.Box
                cssClasses={['card', 'background', 'vertical']}
                spacing={8}
                orientation={Gtk.Orientation.VERTICAL}
            >
                <Gtk.Box visible={computed(() => !!captureBusy() && !recording())} spacing={8} css={'padding: 8px 12px;'}>
                    <Gtk.Spinner spinning />
                    <Gtk.Label label="Preparando captura…" />
                </Gtk.Box>
                <Gtk.Box visible={recording} spacing={8} css={'padding: 8px 12px;'}>
                    <Gtk.Image iconName="media-record-symbolic" cssClasses={['error']} pixelSize={16} />
                    <Gtk.Label label="Gravando" cssClasses={['error', 'heading']} />
                    <Gtk.Label label={elapsedLabel} cssClasses={['monospace']} />
                    <Gtk.Image visible={bind(ss.prefs, 'audio')} iconName="audio-input-microphone-symbolic" pixelSize={14} />
                    <Gtk.Button onClicked={() => ss.stopRecording()} cssClasses={['destructive-action']} tooltipText="Parar gravação">
                        <Gtk.Image iconName="media-playback-stop-symbolic" />
                    </Gtk.Button>
                </Gtk.Box>
                <Gtk.Box visible={computed(() => !recording() && !captureBusy() && !!captureResult())} orientation={Gtk.Orientation.VERTICAL} spacing={8} css={'padding: 12px;'}>
                    <Gtk.Label label={captureKind.as(kind => kind === 'screenshot' ? 'Captura concluída' : 'Gravação concluída')} cssClasses={['heading']} />
                    <Gtk.Picture
                        visible={captureKind.as(kind => kind === 'screenshot')}
                        file={captureResult.as(path => path ? Gio.File.new_for_path(path) : null)}
                        canShrink contentFit={Gtk.ContentFit.CONTAIN} heightRequest={180} />
                    <Gtk.Label label={captureResult.as(path => path || '')} selectable wrap wrapMode={Pango.WrapMode.WORD_CHAR} maxWidthChars={60} />
                    <Gtk.Box spacing={8} halign={Gtk.Align.END}>
                        <Gtk.Button label="Abrir arquivo" onClicked={() => {
                            const path = ss.captureResult;
                            if (path) Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(path).get_uri(), null);
                        }} />
                        <Gtk.Button label="Abrir pasta" onClicked={() => {
                            const path = ss.captureResult;
                            if (!path) return;
                            const parent = Gio.File.new_for_path(path).get_parent();
                            if (parent) Gio.AppInfo.launch_default_for_uri(parent.get_uri(), null);
                        }} />
                        <Gtk.Button label="Concluir" onClicked={() => ss.clearCaptureFeedback()} />
                    </Gtk.Box>
                </Gtk.Box>
                <Gtk.Box visible={computed(() => !recording() && !captureBusy() && !!captureError())} orientation={Gtk.Orientation.VERTICAL} spacing={8} css={'padding: 12px;'} cssClasses={['error']}>
                    <Gtk.Label label="Falha na captura/gravação" cssClasses={['heading']} />
                    <Gtk.Label label={captureError.as(message => message || '')} wrap selectable />
                    <Gtk.Button label="Fechar" halign={Gtk.Align.END} onClicked={() => ss.clearCaptureFeedback()} />
                </Gtk.Box>
            </Gtk.Box>
            </Adw.Clamp>
        </Astal.Window>
    );
};
