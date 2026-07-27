import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, computed, effect, isAccessor, type GnimNode} from 'gnim';
import {usePopoverCleanup} from './popoverCleanup';

interface QuickToggleButtonProps {
    icon: Accessor<string> | string;
    label: Accessor<string> | string;
    cssClasses?: Accessor<string[]> | string[];
    onClick?: () => void;
    popover?: Accessor<GnimNode> | GnimNode;
    hexpand?: boolean;
    visible?: Accessor<boolean> | boolean;
    active?: Accessor<boolean> | boolean;
}

export const QuickToggleButton = (
    props: QuickToggleButtonProps
): GnimNode => {
    // Neither Gtk.Button nor Adw.SplitButton expose an `active` state that
    // fits a toggle — reflect `active` through the 'active' css class.
    // Narrow via local consts so instanceof narrowing holds inside the closure.
    const css = props.cssClasses;
    const act = props.active;

    const mergedCss =
        isAccessor(css) || isAccessor(act)
            ? computed(() => {
                  const base = isAccessor(css) ? css() : (css ?? ['raised']);
                  const isActive = isAccessor(act) ? act() : act;
                  return isActive ? [...base, 'active'] : base;
              })
            : [...(css ?? ['raised']), ...(act ? ['active'] : [])];

    if (props.popover) {
        const popoverNode = isAccessor(props.popover) ? props.popover() : props.popover;
        let splitButton: Adw.SplitButton | null = null;
        effect(() => {
            if (!splitButton) return;
            let child = splitButton.get_first_child();
            while (child) {
                if (child instanceof Gtk.Popover) {
                    splitButton.popover = child;
                    break;
                }
                child = child.get_next_sibling();
            }
        });

        return <Adw.SplitButton
                visible={props.visible ?? true}
                cssClasses={mergedCss}
                hexpand={props.hexpand ?? true}
                ref={self => { splitButton = self; usePopoverCleanup(self); }}
                onClicked={props.onClick}
            >
                {popoverNode}
                <Adw.ButtonContent iconName={props.icon} label={props.label} />
            </Adw.SplitButton>;
    }

    return <Gtk.Button
            visible={props.visible ?? true}
            cssClasses={mergedCss}
            hexpand={props.hexpand ?? true}
            onClicked={props.onClick}
        >
            <Adw.ButtonContent iconName={props.icon} label={props.label} />
        </Gtk.Button>;
};
