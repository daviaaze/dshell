import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, createState} from 'gnim';

type SliderProps = {
    icon: Accessor<string> | string;
    visible?: Accessor<boolean> | boolean;
    min: number;
    max: number;
    value: Accessor<number>;
    setValue: (value: number) => void;
    onIconClick?: () => void;
};

const DEBOUNCE_MS = 80;

export const Slider = (props: SliderProps) => {
    const safe = (v: number) => (Number.isFinite(v) ? v : 0);
    const [displayValue, setDisplayValue] = createState(safe(props.value()));
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let sliderRef: Astal.Slider | null = null;
    let programmaticSet = false;

    const debouncedSetValue = (value: number) => {
        // Ignore onChangeValue triggered by programmatic set_value()
        if (programmaticSet) return;
        setDisplayValue(value);
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            props.setValue(value);
            debounceTimer = null;
        }, DEBOUNCE_MS);
    };

    // Sync external value changes to the slider imperatively (not via reactive binding)
    props.value.subscribe(() => {
        const v = safe(props.value());
        setDisplayValue(v);
        if (sliderRef && debounceTimer === null) {
            programmaticSet = true;
            sliderRef.set_value(v);
            programmaticSet = false;
        }
    });

    return (
        <Gtk.Box cssClasses={['slider']} spacing={4} visible={props.visible}>
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
                $={self => {
                    sliderRef = self;
                    self.set_value(safe(displayValue()));
                }}
                onChangeValue={({value}) => debouncedSetValue(safe(value))}
            />
            <Gtk.Label
                cssClasses={['heading']}
                label={displayValue(v =>
                    (v ?? 0).toFixed(0).toString().concat('%')
                )}
            />
        </Gtk.Box>
    );
};
