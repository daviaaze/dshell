import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import {type Accessor, computed, effect, type GnimNode, isAccessor} from 'gnim';
import {usePopoverCleanup} from './popoverCleanup';

type Reactive<T> = T | Accessor<T>;
interface QuickControlBaseProps {
    icon: Reactive<string>;
    domain: string;
    value: Reactive<string>;
    actionLabel: Reactive<string>;
    menu?: {label: string; popover: GnimNode};
    cssClasses?: Reactive<string[]>;
    hexpand?: boolean;
    visible?: Reactive<boolean>;
    sensitive?: Reactive<boolean>;
}
type QuickControlButtonProps = QuickControlBaseProps & (
    | {intent: 'toggle'; active: Reactive<boolean>; onClick: () => void}
    | {intent: 'action'; active?: never; onClick: () => void}
);

export const QuickControlButton = (props: QuickControlButtonProps): GnimNode => {
    const value = computed(() => isAccessor(props.value) ? props.value() : props.value);
    const action = computed(() => isAccessor(props.actionLabel) ? props.actionLabel() : props.actionLabel);
    const initialize = (self: Gtk.Button) => {
        effect(() => {
            self.update_property(
                [Gtk.AccessibleProperty.LABEL, Gtk.AccessibleProperty.DESCRIPTION],
                [new GObject.Value(GObject.TYPE_STRING, `${props.domain}: ${value()}`),
                    new GObject.Value(GObject.TYPE_STRING, action())]
            );
        });
        if (props.intent === 'toggle' && self instanceof Gtk.ToggleButton) {
            effect(() => { self.active = isAccessor(props.active) ? props.active() : props.active; });
        }
    };
    const content = (
        <Gtk.Box spacing={8}>
            <Gtk.Image iconName={props.icon} />
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand>
                <Gtk.Label label={props.domain} xalign={0} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={16} />
                <Gtk.Label label={value} xalign={0} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={16} cssClasses={['dimmed', 'caption']} />
            </Gtk.Box>
        </Gtk.Box>
    );
    const primary = props.intent === 'toggle' ? (
        <Gtk.ToggleButton hexpand tooltipText={action} ref={initialize}
            onClicked={(self) => {
                try { props.onClick(); }
                finally { self.active = isAccessor(props.active) ? props.active() : props.active; }
            }}>
            {content}
        </Gtk.ToggleButton>
    ) : (
        <Gtk.Button hexpand tooltipText={action} ref={initialize} onClicked={props.onClick}>
            {content}
        </Gtk.Button>
    );
    return (
        <Gtk.Box spacing={0} cssClasses={computed(() => [
            ...(props.menu ? ['linked'] : []),
            ...(isAccessor(props.cssClasses) ? props.cssClasses() : props.cssClasses ?? []),
        ])} hexpand={props.hexpand ?? true} visible={props.visible ?? true} sensitive={props.sensitive ?? true}>
            {primary}
            {props.menu && (
                <Gtk.MenuButton iconName={'pan-down-symbolic'} tooltipText={props.menu.label}
                    ref={(self) => {
                        self.update_property([Gtk.AccessibleProperty.LABEL],
                            [new GObject.Value(GObject.TYPE_STRING, props.menu!.label)]);
                        usePopoverCleanup(self);
                    }}>
                    {props.menu.popover}
                </Gtk.MenuButton>
            )}
        </Gtk.Box>
    );
};
