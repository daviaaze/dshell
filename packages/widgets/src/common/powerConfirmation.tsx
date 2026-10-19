import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import GLib from 'gi://GLib?version=2.0';

export type ConfirmablePowerAction = 'logout' | 'reboot' | 'poweroff';
const openDialogs = new WeakMap<Gtk.Window, Adw.AlertDialog>();
const COPY: Record<ConfirmablePowerAction, {heading: string; body: string; confirm: string}> = {
    logout: {heading: 'Log out?', body: 'This ends your session. Unsaved work may be lost.', confirm: 'Log out'},
    reboot: {heading: 'Restart?', body: 'This restarts the computer and ends all sessions. Unsaved work may be lost.', confirm: 'Restart'},
    poweroff: {heading: 'Power off?', body: 'This shuts down the computer and ends all sessions. Unsaved work may be lost.', confirm: 'Power off'},
};

function restoreConfirmationFocus(root: Gtk.Window, target: Gtk.Widget, previousKeymode: Astal.Keymode | null): void {
    if (!root.get_mapped()) return;
    if (!(root instanceof Astal.Window) || previousKeymode !== Astal.Keymode.ON_DEMAND || root.isActive) {
        root.present();
        if (!target.grab_focus()) target.child_focus(Gtk.DirectionType.TAB_FORWARD);
        return;
    }
    let finished = false;
    let activeSignal = 0;
    let unmapSignal = 0;
    let destroySignal = 0;
    const finish = (focus: boolean, destroyed = false) => {
        if (finished) return;
        finished = true;
        for (const id of [activeSignal, unmapSignal, destroySignal]) {
            if (id && GObject.signal_handler_is_connected(root, id)) root.disconnect(id);
        }
        if (destroyed) return;
        root.keymode = previousKeymode;
        if (focus && root.get_mapped() && !openDialogs.has(root) && target.get_root() === root)
            if (!target.grab_focus()) target.child_focus(Gtk.DirectionType.TAB_FORWARD);
    };
    activeSignal = root.connect('notify::is-active', () => {
        if (root.isActive) finish(true);
    });
    unmapSignal = root.connect('unmap', () => finish(false));
    destroySignal = root.connect('destroy', () => finish(false, true));
    // ON_DEMAND cannot request layer focus. Release the temporary exclusive
    // request only after GTK receives compositor keyboard ownership.
    root.keymode = Astal.Keymode.EXCLUSIVE;
    root.present();
    if (root.isActive) finish(true);
}

export function presentPowerConfirmation(parent: Gtk.Widget, action: ConfirmablePowerAction, onConfirm: () => void): void {
    const root = parent.get_root();
    if (!(root instanceof Gtk.Window) || openDialogs.has(root)) return;
    let fallback: Gtk.Widget | null = null;
    let originPopover: Gtk.Popover | null = null;
    for (let ancestor: Gtk.Widget | null = parent; ancestor; ancestor = ancestor.get_parent()) {
        if (ancestor instanceof Gtk.Popover) {
            originPopover = ancestor;
            fallback = ancestor.get_parent();
        }
    }
    const copy = COPY[action];
    const dialog = new Adw.AlertDialog({heading: copy.heading, body: copy.body,
        defaultResponse: 'cancel', closeResponse: 'cancel'});
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('confirm', copy.confirm);
    dialog.set_response_appearance('confirm', Adw.ResponseAppearance.DESTRUCTIVE);
    let alive = true;
    let rootAlive = true;
    let settled = false;
    let closed = false;
    let retired = false;
    let closeSource = 0;
    let rootDestroyed = 0;
    let parentDestroyed = 0;
    let rootUnmapped = 0;
    const originalKeymode = root instanceof Astal.Window ? root.keymode : null;
    const retire = (restoreFocus: boolean) => {
        if (retired) return;
        retired = true;
        if (openDialogs.get(root) === dialog) openDialogs.delete(root);
        for (const id of [rootDestroyed, rootUnmapped])
            if (id && GObject.signal_handler_is_connected(root, id)) root.disconnect(id);
        if (parentDestroyed && GObject.signal_handler_is_connected(parent, parentDestroyed)) parent.disconnect(parentDestroyed);
        if (root instanceof Astal.Window && originalKeymode !== null && rootAlive)
            root.keymode = originalKeymode;
        const target = fallback ?? parent;
        if (restoreFocus && target.get_root() === root)
            restoreConfirmationFocus(root, target, originalKeymode);
    };
    const cancel = () => {
        alive = false;
        retire(false);
        dialog.force_close();
    };
    rootDestroyed = root.connect('destroy', () => { rootAlive = false; cancel(); });
    parentDestroyed = parent === root ? 0 : parent.connect('destroy', cancel);
    rootUnmapped = root.connect('unmap', () => {
        alive = false;
        // A hidden native fallback may never emit closed. Retire ownership now,
        // before another presentation, without closing during GTK's unmap stack.
        retire(false);
        if (closed || closeSource) return;
        closeSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            closeSource = 0;
            if (!closed) dialog.force_close();
            return GLib.SOURCE_REMOVE;
        });
    });
    // Adwaita uses a separate Gtk.Window for an Astal parent. A layer
    // keyboard grab would prevent that native dialog from receiving Escape.
    if (root instanceof Astal.Window) root.keymode = Astal.Keymode.NONE;
    openDialogs.set(root, dialog);
    dialog.connect('response', (_self, response) => {
        if (settled) return;
        settled = true;
        if (response === 'confirm' && alive && root.get_mapped() && parent.get_root() === root) onConfirm();
    });
    dialog.connect('closed', () => {
        closed = true;
        if (closeSource) GLib.source_remove(closeSource);
        closeSource = 0;
        // Fallback windows may close before AlertDialog emits its response.
        // Only response consumption, or an invalid parent, settles the action.
        retire(alive);
    });
    originPopover?.popdown();
    root.present();
    dialog.present(root);
    const dialogRoot = dialog.get_root();
    if (dialogRoot instanceof Gtk.Window && dialogRoot !== root) dialogRoot.present();
}
