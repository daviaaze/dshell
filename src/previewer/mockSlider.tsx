/**
 * MockSlider — pure GTK4 version of Astal.Slider for the previewer.
 *
 * Uses Gtk.Scale with Gtk.Adjustment instead of Astal.Slider.
 */

import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, createState} from 'gnim';

interface MockSliderProps {
    icon?: string;
    value?: number;
    min?: number;
    max?: number;
    showLabel?: boolean;
}

export const MockSlider = (props: MockSliderProps) => {
    const [val, setVal] = createState(props.value ?? 50);

    const adjustment = new Gtk.Adjustment({
        value: props.value ?? 50,
        lower: props.min ?? 0,
        upper: props.max ?? 100,
        stepIncrement: 1,
    });

    adjustment.connect('value-changed', () => {
        setVal(adjustment.value);
    });

    return (
        <Gtk.Box spacing={8} hexpand>
            {props.icon && <Gtk.Image iconName={props.icon} pixelSize={16} />}
            <Gtk.Scale hexpand adjustment={adjustment} drawValue={false} />
            {props.showLabel && (
                <Gtk.Label
                    label={val(v => `${Math.round(v)}%`)}
                    cssClasses={['caption']}
                />
            )}
        </Gtk.Box>
    );
};
