import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {usePopoverCleanup} from './popoverCleanup';

interface IconButtonProps {
    icon: string;
    onClicked?: () => void;
    cssClasses?: string[];
    tooltipText?: string;
    cursor?: Gdk.Cursor;
}

export const IconButton = (props: IconButtonProps) => (
    <Gtk.Button
        iconName={props.icon}
        cssClasses={['circular', ...(props.cssClasses ?? [])]}
        onClicked={props.onClicked}
        tooltipText={props.tooltipText}
        cursor={props.cursor}
    />
);

interface IconMenuButtonProps extends Omit<IconButtonProps, 'onClicked'> {
    popover: Gtk.Popover;
}

export const IconMenuButton = (props: IconMenuButtonProps) => (
    <Gtk.MenuButton
        cssClasses={['circular', ...(props.cssClasses ?? [])]}
        popover={props.popover}
        tooltipText={props.tooltipText}
        cursor={props.cursor}
        $={usePopoverCleanup}
    >
        <Gtk.Image iconName={props.icon} />
    </Gtk.MenuButton>
);
