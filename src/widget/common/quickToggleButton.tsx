import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, createComputed} from 'gnim';
import {usePopoverCleanup} from './popoverCleanup';

interface QuickToggleButtonProps {
    icon: Accessor<string> | string;
    label: Accessor<string> | string;
    cssClasses?: Accessor<string[]> | string[];
    onClick?: () => void;
    popover?: Accessor<Gtk.Popover>;
    hexpand?: boolean;
    visible?: Accessor<boolean> | boolean;
    active?: Accessor<boolean> | boolean;
}

export const QuickToggleButton = (props: QuickToggleButtonProps) => {
    if (props.popover) {
        return (
            <Adw.SplitButton
                visible={props.visible ?? true}
                cssClasses={props.cssClasses ?? ['raised']}
                hexpand={props.hexpand ?? true}
                $={usePopoverCleanup}
                onClicked={props.onClick}
                popover={props.popover}
                active={props.active}
            >
                <Adw.ButtonContent iconName={props.icon} label={props.label} />
            </Adw.SplitButton>
        );
    }
    // Gtk.Button has no built-in `active` property (Adw.SplitButton does).
    // Compose cssClasses so the 'active' class is added when active is true.
    const isActiveAccessor = props.active instanceof Accessor;
    const isCssAccessor = props.cssClasses instanceof Accessor;

    const mergedCss = isActiveAccessor || isCssAccessor
        ? createComputed(() => [
              ...(isCssAccessor ? props.cssClasses?.() ?? ['raised'] : props.cssClasses ?? ['raised']),
              ...(isActiveAccessor ? props.active() ? ['active'] : [] : props.active ? ['active'] : []),
          ])
        : [
              ...(props.cssClasses ?? ['raised']),
              ...(props.active ? ['active'] : []),
          ];

    return (
        <Gtk.Button
            visible={props.visible ?? true}
            cssClasses={mergedCss}
            hexpand={props.hexpand ?? true}
            onClicked={props.onClick}
        >
            <Adw.ButtonContent iconName={props.icon} label={props.label} />
        </Gtk.Button>
    );
};
