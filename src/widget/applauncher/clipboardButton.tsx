import Gtk from 'gi://Gtk?version=4.0';
import {
    formatClipboardPreview,
    copyClipboardItem,
} from '#/lib/services/clipboard';
import WindowManager from '#/lib/services/state/windowManager';
import {useStyle} from '#/style/useStyle';
import {ClipboardEntry} from '#/lib/services/clipboard/encryptedStore';

export default ({item}: {item: ClipboardEntry}) => {
    const preview = formatClipboardPreview(item.content);
    const appButtonStyle = useStyle({
        padding: '6px',
        'border-radius': '8px',
        background: 'transparent',
        '&:hover': {
            background: 'var(--shade-hover-bg)',
        },
        '&:active': {
            background: 'var(--shade-active-bg)',
        },
    });

    return (
        <Gtk.Button
            cssClasses={['app-button', appButtonStyle.class]}
            ref={appButtonStyle.$}
            onClicked={() => {
                copyClipboardItem(item);
                WindowManager.get_default().applauncher!.visible = false;
            }}
        >
            <Gtk.Box spacing={12} valign={Gtk.Align.CENTER}>
                <Gtk.Image
                    iconName={
                        item.type === 'image'
                            ? 'image-x-generic-symbolic'
                            : 'edit-paste-symbolic'
                    }
                    pixelSize={32}
                />
                <Gtk.Box
                    orientation={Gtk.Orientation.VERTICAL}
                    valign={Gtk.Align.CENTER}
                >
                    <Gtk.Label
                        cssClasses={['title-2']}
                        halign={Gtk.Align.START}
                        label={preview}
                    />
                    <Gtk.Label
                        halign={Gtk.Align.START}
                        label={`ID: ${item.id}`}
                        cssClasses={['caption']}
                    />
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Button>
    );
};
