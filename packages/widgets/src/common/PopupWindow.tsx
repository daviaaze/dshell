/**
 * PopupWindow — shared Astal.Window wrapper for all popup-style widgets.
 *
 * Eliminates duplicated boilerplate across applauncher, quicksettings,
 * notifications, OSD, region-selector, and screenshot-ui.
 *
 * Usage:
 * ```tsx
 * <PopupWindow
 *   name="quicksettings"
 *   visible={qsBinding}
 *   anchor={anchors}
 *   onClose={() => {}}
 * >
 *   {content}
 * </PopupWindow>
 * ```
 */
import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, bind, createState, JSX} from 'gnim';
import {getApp} from '@shade/services/appHandle';
import {useSettings} from '@shade/services/settings/index';
import {getHyprland} from '@shade/services/hyprland';

// ── Types ──

const {TOP, BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;

export interface PopupWindowProps {
    /** Unique window name, used as the Astal namespace. */
    name: string;

    /** Reactive visibility binding. */
    visible: Accessor<boolean> | boolean;

    /** Widget reference callback. */
    ref?: (self: Astal.Window) => void;

    /**
     * Bar-position-derived anchor or explicit anchor bitmask.
     * Auto-derived from `bar.position` GSetting by default.
     */
    /** Bitmask of Astal.WindowAnchor. */
    anchor?: Accessor<number> | number;

    /** Astal layer preference. Defaults to OVERLAY. */
    layer?: Astal.Layer;

    /** Margin from the window edges. Defaults to 12. */
    margin?: number;

    /**
     * Callback when the popup closes (via ESC, or externally).
     * Called ONCE after the close animation.
     */
    onClose?: () => void;

    /** Called when visible changes externally. */
    onVisibleChange?: (visible: boolean) => void;

    /** Additional CSS classes. */
    cssClasses?: string[];

    /** Width constraint (e.g. 420 for quicksettings). */
    widthRequest?: number;

    /** Height constraint. */
    heightRequest?: number;

    /** Monitor index to show on. Defaults to focused Hyprland monitor. */
    monitor?: Accessor<number> | number;

    /**
     * Widget lifecycle callback, passed through to the underlying Astal.Window.
     * Use for WindowManager registration.
     */
    $?: (self: Astal.Window) => void;

    children: JSX.Element | JSX.Element[];
}

export interface PopupHandle {
    /** Element to render (pass as JSX child of PopupWindow). */
    element: JSX.Element;
}

// ── Default anchor from bar position ──

/** Bar height/width offset so popups don't overlap the bar. */
const BAR_MARGIN_TOP_BOTTOM = 40;
const BAR_MARGIN_SIDE = 8;

function defaultAnchor(position: number): number {
    if (position === TOP) return TOP | LEFT | RIGHT;
    if (position === RIGHT) return RIGHT | TOP | BOTTOM;
    if (position === BOTTOM) return BOTTOM | LEFT | RIGHT;
    if (position === LEFT) return LEFT | TOP | BOTTOM;
    return TOP | LEFT | RIGHT;
}

function anchorMargin(position: number): number {
    if (position === TOP) return BAR_MARGIN_TOP_BOTTOM;
    if (position === RIGHT) return BAR_MARGIN_SIDE;
    if (position === BOTTOM) return BAR_MARGIN_TOP_BOTTOM;
    if (position === LEFT) return BAR_MARGIN_SIDE;
    return 12;
}

// ── Component ──

export default (props: PopupWindowProps) => {
    const {
        name,
        visible,
        anchor: anchorProp,
        layer,
        margin: marginProp,
        onClose,
        onVisibleChange,
        cssClasses,
        widthRequest,
        heightRequest,
        monitor: monitorProp,
        $: widgetRef,
        children,
    } = props;

    const barCfg = useSettings().bar;
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const defaultMon = bind(hyprland, 'focused-monitor').as(m => m.id);

    // Resolve anchor
    let anchorValue: Accessor<number> | number;
    if (anchorProp !== undefined) {
        anchorValue = anchorProp;
    } else {
        anchorValue = barCfg.position.as(p => defaultAnchor(p));
    }

    // Resolve margin
    const resolvedMargin =
        marginProp ?? barCfg.position.as(p => anchorMargin(p));

    // Resolve monitor
    const resolvedMonitor = monitorProp ?? defaultMon;

    // Resolve visible as accessor for the binding
    const visibleAccessor: Accessor<boolean> =
        typeof visible === 'function' ? visible : createState(visible)[0];

    return (
        <Astal.Window
            name={name}
            namespace={name}
            visible={visibleAccessor}
            application={getApp()}
            layer={layer}
            keymode={Astal.Keymode.ON_DEMAND}
            anchor={anchorValue}
            margin={resolvedMargin}
            monitor={resolvedMonitor}
            widthRequest={widthRequest}
            heightRequest={heightRequest}
            cssClasses={['card', 'frame', ...(cssClasses ?? [])]}
            onNotifyVisible={(self: Astal.Window) => {
                if (onVisibleChange) onVisibleChange(self.visible);
            }}
            ref={widgetRef}
        >
            <Gtk.EventControllerKey
                ref={self => {
                    self.connect(
                        'key-pressed',
                        (_ctrl, keyval, _keycode, _state) => {
                            if (keyval === Gdk.KEY_Escape) {
                                // Toggle visible off via the accessor mechanism
                                if (onClose) onClose();
                                return true;
                            }
                            return false;
                        }
                    );
                }}
            />
            {children}
        </Astal.Window>
    );
};
