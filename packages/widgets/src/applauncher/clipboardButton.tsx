import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import type {ClipboardEntry} from '@shade/services/clipboard/encryptedStore';
import {copyClipboardItem} from '@shade/services/clipboard/index';
import WindowManager from '@shade/services/state/windowManager';

/** "Texto · 25/11 14:30" — what was copied and when, instead of the internal id. */
function entryCaption(item: ClipboardEntry): string {
    const kind = item.type === 'image' ? 'Imagem' : 'Texto';
    const copiedAt = GLib.DateTime.new_from_unix_local(Math.floor(item.timestamp / 1000));
    return `${kind} · ${copiedAt?.format('%d/%m %H:%M') ?? ''}`;
}

export default ({item}: {item: ClipboardEntry}) => {
    const preview =
        item.type === 'image'
            ? `Imagem ${item.mimeType.replace(/^image\//, '').toUpperCase()}`
            : item.content;

    return (
        <Gtk.Button
            cssClasses={['app-button', 'flat']}
            onClicked={() => {
                copyClipboardItem(item);
                const launcher = WindowManager.get_default().applauncher;
                if (launcher) launcher.visible = false;
            }}
        >
            <Gtk.Box spacing={12} valign={Gtk.Align.CENTER}>
                <Gtk.Image
                    iconName={
                        item.type === 'image' ? 'image-x-generic-symbolic' : 'edit-paste-symbolic'
                    }
                    pixelSize={32}
                />
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER} hexpand>
                    <Gtk.Label
                        cssClasses={['title-2']}
                        xalign={0}
                        hexpand
                        maxWidthChars={40}
                        ellipsize={Pango.EllipsizeMode.END}
                        label={preview}
                        tooltipText={item.type === 'text' ? item.content : preview}
                    />
                    <Gtk.Label
                        xalign={0}
                        maxWidthChars={40}
                        ellipsize={Pango.EllipsizeMode.END}
                        label={entryCaption(item)}
                        cssClasses={['caption']}
                    />
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Button>
    );
};
