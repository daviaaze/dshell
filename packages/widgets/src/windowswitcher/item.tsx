import type AstalHyprland from 'gi://AstalHyprland?version=0.1';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import {getAppIcon} from '@shade/services/state/apps';
import type {Accessor} from 'gnim';

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
        marginTop={5}
        marginBottom={5}
        marginStart={14}
        marginEnd={14}
        css={selected.as((s) =>
            s
                ? 'border-radius: calc(var(--window-radius) * 1.5); background-color: alpha(@accent_bg_color, 0.85);'
                : 'border-radius: calc(var(--window-radius) * 1.5);'
        )}
        valign={Gtk.Align.CENTER}
    >
        <Gtk.Image iconName={getAppIcon(client)} pixelSize={48} valign={Gtk.Align.CENTER} />
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
                'background-color: alpha(@window_bg_color, 0.6); border-radius: var(--window-radius); padding: 2px 10px; min-width: 24px;'
            }
        />
    </Gtk.Box>
);
