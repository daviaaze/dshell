import Astal from 'gi://Astal?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {type Accessor, effect, isAccessor} from 'gnim';

type SliderProps = {
    icon: Accessor<string> | string;
    label?: string;
    iconTooltip?: string | Accessor<string>;
    showIcon?: boolean;
    visible?: Accessor<boolean> | boolean;
    min: number;
    max: number;
    value: Accessor<number>;
    setValue: (value: number) => void;
    onIconClick?: () => void;
    ref?: (self: Gtk.Box) => void;
    cssClasses?: string[];
};

const SLIDER_SPACING = 4;

/**
 * The binding reflects confirmed service state. value-changed handles both
 * pointer and accessibility input; programmatic binding writes are guarded
 * at the Gtk.Range setter to avoid feedback from GTK's clamping.
 */
export const Slider = (props: SliderProps) => {
    const safe = (v: number) => (Number.isFinite(v) ? v : 0);

    return (
        <Gtk.Box
            ref={props.ref}
            cssClasses={['slider', 'horizontal', ...(props.cssClasses ?? [])]}
            orientation={Gtk.Orientation.HORIZONTAL}
            spacing={SLIDER_SPACING}
            visible={props.visible}
        >
            {props.onIconClick ? (
                <Gtk.Button
                    visible={props.showIcon !== false}
                    onClicked={props.onIconClick}
                    tooltipText={props.iconTooltip}
                    ref={(self) => {
                        if (!props.iconTooltip) return;
                        effect(() => {
                            const label = isAccessor(props.iconTooltip)
                                ? props.iconTooltip()
                                : props.iconTooltip;
                            self.update_property(
                                [Gtk.AccessibleProperty.LABEL],
                                [new GObject.Value(GObject.TYPE_STRING, label)]
                            );
                        });
                    }}
                >
                    <Gtk.Image iconName={props.icon} />
                </Gtk.Button>
            ) : (
                <Gtk.Image visible={props.showIcon !== false} iconName={props.icon} />
            )}
            <Astal.Slider
                hexpand
                min={props.min}
                max={props.max}
                ref={(self) => {
                    let applyingProgrammaticValue = false;
                    self.connect('value-changed', () => {
                        if (applyingProgrammaticValue) return;
                        props.setValue(safe(self.value));
                    });
                    effect(() => {
                        const value = safe(props.value());
                        if (self.value === value) return;
                        applyingProgrammaticValue = true;
                        try {
                            self.value = value;
                        } finally {
                            applyingProgrammaticValue = false;
                        }
                    });
                    if (props.label)
                        self.update_property(
                            [Gtk.AccessibleProperty.LABEL],
                            [new GObject.Value(GObject.TYPE_STRING, props.label)]
                        );
                }}
            />
            <Gtk.Label
                cssClasses={['heading']}
                label={props.value.as((v) => safe(v).toFixed(0).concat('%'))}
            />
        </Gtk.Box>
    );
};
