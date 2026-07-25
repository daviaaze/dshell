import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {Accessor} from 'gnim';
import {useStyle} from '#/style/useStyle';

type SliderProps = {
    icon: Accessor<string> | string;
    visible?: Accessor<boolean> | boolean;
    min: number;
    max: number;
    value: Accessor<number>;
    setValue: (value: number) => void;
    onIconClick?: () => void;
};

const SLIDER_SPACING = 4;

/**
 * Follows the Astal/AstalWp contract: value is bound reactively (services
 * only notify confirmed state changes) and user input is written back
 * immediately via change-value. No debounce or manual sync — delaying the
 * write leaves the service reporting the old value, and any read in that
 * window snaps the handle back (flicker).
 */
export const Slider = (props: SliderProps) => {
    const sliderStyle = useStyle({
        'min-width': '180px',
    });
    const safe = (v: number) => (Number.isFinite(v) ? v : 0);

    return (
        <Gtk.Box
            cssClasses={['slider', sliderStyle.class]}
            spacing={SLIDER_SPACING}
            visible={props.visible}
            ref={sliderStyle.$}
        >
            {props.onIconClick ? (
                <Gtk.Button onClicked={props.onIconClick}>
                    <Gtk.Image iconName={props.icon} />
                </Gtk.Button>
            ) : (
                <Gtk.Image iconName={props.icon} />
            )}
            <Astal.Slider
                hexpand
                min={props.min}
                max={props.max}
                value={props.value.as(safe)}
                onChangeValue={(_self, _scroll, value) => {
                    props.setValue(safe(value));
                    return false;
                }}
            />
            <Gtk.Label
                cssClasses={['heading']}
                label={props.value.as(v => safe(v).toFixed(0).concat('%'))}
            />
        </Gtk.Box>
    );
};
