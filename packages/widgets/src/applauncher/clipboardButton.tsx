import Gtk from 'gi://Gtk?version=4.0';
import {
    formatClipboardPreview,
    copyClipboardItem,
} from '@shade/services/clipboard/index';
import WindowManager from '@shade/services/state/windowManager';
import {ClipboardEntry} from '@shade/services/clipboard/encryptedStore';

export default ({item}: {item: ClipboardEntry}) => {
    const preview = formatClipboardPreview(item.content);

    return (
        <Gtk.Button
            cssClasses={['app-button', 'flat']}
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
