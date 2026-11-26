/**
 * PopupWindow — Astal.Window wrapper for corner-anchored popups.
 *
 * Currently used by the notification toasts. The caller owns visibility:
 * the window never hides itself.
 *
 * Usage:
 * ```tsx
 * <PopupWindow
 *   name="notifications"
 *   visible={hasToasts}
 *   anchor={anchors}
 *   onClose={() => setOpen(false)}
 * >
 *   {content}
 * </PopupWindow>
 * ```
 */
import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {getApp} from '@shade/services/appHandle';
import {getHyprland} from '@shade/services/hyprland';
import {barSettings} from '@shade/services/settings/bar.gschema';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {type Accessor, bind, type JSX} from 'gnim';
import {SURFACE_EDGE_GAP} from './surface';

// ── Types ──

const {TOP, BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;
export interface PopupWindowProps {
    /** Unique window name, used as the Astal namespace. */
    name: string;

    /** Visibility, owned by the caller; pass an accessor to make it reactive. */
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

    /** Keyboard ownership; passive toasts use NONE. */
    keymode?: Astal.Keymode;

    /** Outer layer margin. Defaults to the shared 4px shell edge gap. */
    margin?: number;

    /**
     * Close request: called when the user presses Escape. The caller must
     * turn `visible` off. Without it, Escape is left for other handlers.
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

// ── Default anchor from bar position ──

/** Use a corner by default so transparent popups never span the full monitor. */
function defaultAnchor(position: number): number {
    if (position === BOTTOM) return BOTTOM | RIGHT;
    if (position === LEFT) return TOP | LEFT;
    return TOP | RIGHT;
}

// ── Component ──

export default (props: PopupWindowProps) => {
    const {
        name,
        visible,
        anchor: anchorProp,
        layer,
        keymode,
        margin: marginProp,
        onClose,
        onVisibleChange,
        cssClasses,
        widthRequest,
        heightRequest,
        monitor: monitorProp,
        $: widgetRef,
        ref: refProp,
        children,
    } = props;

    const barCfg = barSettings();
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const defaultMon = bind(hyprland, 'focused-monitor').as((m) => monitorIndexFromHyprland(m));

    // Resolve anchor
    let anchorValue: Accessor<number> | number;
    if (anchorProp !== undefined) {
        anchorValue = anchorProp;
    } else {
        anchorValue = barCfg.position.as((p) => defaultAnchor(p));
    }

    // Resolve margin
    const resolvedMargin = marginProp ?? SURFACE_EDGE_GAP;

    // Resolve monitor
    const resolvedMonitor = monitorProp ?? defaultMon;

    return (
        <Astal.Window
            name={name}
            namespace={`shade-${name}`}
            visible={visible}
            application={getApp()}
            layer={layer}
            keymode={keymode ?? Astal.Keymode.ON_DEMAND}
            anchor={anchorValue}
            margin={resolvedMargin}
            monitor={resolvedMonitor}
            widthRequest={widthRequest}
            heightRequest={heightRequest}
            cssClasses={cssClasses ?? []}
            onNotifyVisible={(self: Astal.Window) => {
                if (onVisibleChange) onVisibleChange(self.visible);
            }}
            ref={(self: Astal.Window) => {
                refProp?.(self);
                widgetRef?.(self);
            }}
        >
            <Gtk.EventControllerKey
                ref={(self) => {
                    self.connect('key-pressed', (_ctrl, keyval, _keycode, _state) => {
                        if (keyval !== Gdk.KEY_Escape || !onClose) return false;
                        onClose();
                        return true;
                    });
                }}
            />
            {children}
        </Astal.Window>
    );
};
