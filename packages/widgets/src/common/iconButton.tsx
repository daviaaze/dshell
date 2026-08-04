import type Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import type {JSX} from 'gnim';
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
    children?: JSX.Element | JSX.Element[];
}

export const IconMenuButton = (props: IconMenuButtonProps) => (
    <Gtk.MenuButton
        cssClasses={['circular', ...(props.cssClasses ?? [])]}
        tooltipText={props.tooltipText}
        cursor={props.cursor}
        ref={usePopoverCleanup}
    >
        {props.children}
        <Gtk.Image iconName={props.icon} />
    </Gtk.MenuButton>
);
