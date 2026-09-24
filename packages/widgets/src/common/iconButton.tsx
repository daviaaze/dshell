import type Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import type {JSX} from 'gnim';
import {usePopoverCleanup} from './popoverCleanup';

interface IconButtonProps {
    icon: string;
    accessibleLabel: string;
    accessibleDescription?: string;
    onClicked?: () => void;
    cssClasses?: string[];
    tooltipText?: string;
    cursor?: Gdk.Cursor;
}


const setAccessibleName = (label: string, description?: string) => (self: Gtk.Accessible) => {
    self.update_property([Gtk.AccessibleProperty.LABEL], [new GObject.Value(GObject.TYPE_STRING, label)]);
    if (description) {
        self.update_property(
            [Gtk.AccessibleProperty.DESCRIPTION],
            [new GObject.Value(GObject.TYPE_STRING, description)]
        );
    }
};

export const IconButton = (props: IconButtonProps) => (
    <Gtk.Button
        iconName={props.icon}
        cssClasses={['circular', ...(props.cssClasses ?? [])]}
        onClicked={props.onClicked}
        tooltipText={props.tooltipText ?? props.accessibleLabel}
        cursor={props.cursor}
        ref={setAccessibleName(props.accessibleLabel, props.accessibleDescription)}
    />
);

interface IconMenuButtonProps extends Omit<IconButtonProps, 'onClicked'> {
    children?: JSX.Element | JSX.Element[];
}

export const IconMenuButton = (props: IconMenuButtonProps) => (
    <Gtk.MenuButton
        cssClasses={['circular', ...(props.cssClasses ?? [])]}
        tooltipText={props.tooltipText ?? props.accessibleLabel}
        cursor={props.cursor}
        ref={(self) => {
            setAccessibleName(props.accessibleLabel, props.accessibleDescription)(self);
            usePopoverCleanup(self);
        }}
    >
        {props.children}
        <Gtk.Image iconName={props.icon} />
    </Gtk.MenuButton>
);

