import Gtk from 'gi://Gtk?version=4.0';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import Pango from 'gi://Pango?version=1.0';
import {Accessor} from 'gnim';
import {getAppIcon} from '#/lib/apps';

export default ({
    client,
    selected,
}: {
    client: AstalHyprland.Client;
    selected: Accessor<boolean>;
}) => (
    <Gtk.Box
        spacing={12}
        cssClasses={['card']}
        css={selected.as(s =>
            s
                ? 'padding: 10px 14px; border-radius: 12px; background-color: alpha(@accent_bg_color, 0.85);'
                : 'padding: 10px 14px; border-radius: 12px;'
        )}
        valign={Gtk.Align.CENTER}
    >
        <Gtk.Image
            iconName={getAppIcon(client)}
            pixelSize={48}
            valign={Gtk.Align.CENTER}
        />
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            valign={Gtk.Align.CENTER}
            spacing={2}
            hexpand
        >
            <Gtk.Label
                label={client.title || client.class || 'Unknown'}
                maxWidthChars={35}
                ellipsize={Pango.EllipsizeMode.END}
                xalign={0}
                cssClasses={['title-3']}
            />
            <Gtk.Label
                label={client.class || ''}
                maxWidthChars={35}
                ellipsize={Pango.EllipsizeMode.END}
                xalign={0}
                cssClasses={['caption']}
            />
        </Gtk.Box>
        <Gtk.Label
            label={String(client.workspace?.id ?? '?')}
            cssClasses={['numeric', 'caption']}
            valign={Gtk.Align.CENTER}
            halign={Gtk.Align.END}
            css={
                'background-color: alpha(@window_bg_color, 0.6); border-radius: 999px; padding: 2px 10px; min-width: 24px;'
            }
        />
    </Gtk.Box>
);
