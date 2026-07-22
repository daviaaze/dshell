import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, createState} from 'gnim';
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

const DEBOUNCE_MS = 80;
const PENDING_TIMEOUT_MS = 500;
const SYNC_TOLERANCE = 1;
const SLIDER_SPACING = 4;

export const Slider = (props: SliderProps) => {
    const sliderStyle = useStyle({
        'min-width': '180px',
    });
    const safe = (v: number) => (Number.isFinite(v) ? v : 0);
    const [displayValue, setDisplayValue] = createState(safe(props.value()));
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    let sliderRef: Astal.Slider | null = null;
    let programmaticSet = false;

    // Target of the latest user-initiated change. While set, external
    // values that don't match it are stale echoes of the old value
    // (service round-trip latency) and are ignored to avoid flicker.
    let pendingValue: number | null = null;

    const clearPending = () => {
        pendingValue = null;
        if (pendingTimer !== null) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
        }
    };

    const markPending = (value: number) => {
        pendingValue = value;
        if (pendingTimer !== null) clearTimeout(pendingTimer);
        // Safety net: if no confirmation ever arrives, resume normal sync
        pendingTimer = setTimeout(clearPending, PENDING_TIMEOUT_MS);
    };

    const debouncedSetValue = (value: number) => {
        // Ignore onChangeValue triggered by programmatic set_value()
        if (programmaticSet) return;
        setDisplayValue(value);
        markPending(value);
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            props.setValue(value);
            debounceTimer = null;
        }, DEBOUNCE_MS);
    };

    // Sync external value changes to the slider imperatively (not via reactive binding)
    props.value.subscribe(() => {
        const v = safe(props.value());
        if (pendingValue !== null) {
            if (Math.abs(v - pendingValue) <= SYNC_TOLERANCE) {
                // Confirmation of our own change — resume normal sync
                clearPending();
            } else {
                // Stale echo of the previous value — ignore
                return;
            }
        }
        setDisplayValue(v);
        if (sliderRef && debounceTimer === null) {
            const current = sliderRef.get_value();
            // Only move the handle for perceptible differences, avoiding
            // micro-jumps from service-side value quantization
            if (Math.abs(v - current) > SYNC_TOLERANCE) {
                programmaticSet = true;
                sliderRef.set_value(v);
                programmaticSet = false;
            }
        }
    });

    return (
        <Gtk.Box cssClasses={['slider', sliderStyle.class]} spacing={SLIDER_SPACING} visible={props.visible} $={sliderStyle.$}>
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
