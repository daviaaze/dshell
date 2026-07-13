import Gtk from 'gi://Gtk?version=4.0';
import {Accessor} from 'gnim';

const ROW_SPACING = 4;
const ROW_MARGIN = 8;
const DEFAULT_ICON_SIZE = 20;

interface IconInfoRowProps {
    icon: Accessor<string> | string;
    primary: Accessor<string> | string;
    secondary?: Accessor<string> | string;
    pixelSize?: number;
    visible?: Accessor<boolean> | boolean;
}

export const IconInfoRow = (props: IconInfoRowProps) => (
    <Gtk.Box
        spacing={ROW_SPACING}
        marginStart={ROW_MARGIN}
        marginEnd={ROW_MARGIN}
        hexpand
        halign={Gtk.Align.CENTER}
        visible={props.visible ?? true}
    >
        <Gtk.Image
            iconName={props.icon}
            pixelSize={props.pixelSize ?? DEFAULT_ICON_SIZE}
        />
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
            <Gtk.Label label={props.primary} />
            {props.secondary && <Gtk.Label label={props.secondary} />}
        </Gtk.Box>
    </Gtk.Box>
);