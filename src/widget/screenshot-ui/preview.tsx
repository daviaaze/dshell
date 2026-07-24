import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';

export interface PreviewCardProps {
    kind: 'monitor' | 'window';
    name: string;
    subtitle?: string;
    onClick: () => void;
}

/**
 * Build a preview thumbnail card. Returns the Picture widget for external
 * texture updates and the Button wrapper.
 */
export function PreviewCard({
    kind: _kind,
    name,
    subtitle,
    onClick,
}: PreviewCardProps): {
    button: Gtk.Button;
    picture: Gtk.Picture;
    setTexture: (path: string) => void;
} {
    const picture = new Gtk.Picture();
    picture.set_size_request(200, 120);
    picture.contentFit = Gtk.ContentFit.SCALE_DOWN;
    picture.add_css_class('picker-preview');

    const label = new Gtk.Label({
        label: name,
        xalign: 0.5,
        css_classes: ['picker-label'],
        ellipsize: 3, // Pango.EllipsizeMode.END
    });

    const inner = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        css_classes: ['picker-card'],
    });
    inner.append(picture);
    inner.append(label);

    if (subtitle) {
        const sub = new Gtk.Label({
            label: subtitle,
            xalign: 0.5,
            css_classes: ['picker-sublabel'],
            ellipsize: 3,
        });
        inner.append(sub);
    }

    const button = new Gtk.Button({child: inner, css_classes: ['flat']});
    button.connect('clicked', onClick);

    const setTexture = (path: string) => {
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            try {
                const tex = Gdk.Texture.new_from_filename(path);
                picture.set_paintable(tex);
            } catch {
                // ignore corrupt files
            }
        }
    };

    return {button, picture, setTexture};
}
