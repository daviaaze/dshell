import type Tray from 'gi://AstalTray';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {bind, effect, type MaybeAccessor} from 'gnim';
import {usePopoverCleanup} from './popoverCleanup';

/** AstalTray's protocol id is app-defined; item-id is runtime registration identity. */
export function trayItemKey(item: Tray.TrayItem): string {
    return item.id || '';
}

export function isTrayItemHidden(item: Tray.TrayItem, hiddenIds: string[]): boolean {
    const key = trayItemKey(item);
    return key !== '' && hiddenIds.includes(key);
}

export function TrayItemButton({
    item,
    visible = true,
}: {
    item: Tray.TrayItem;
    visible?: MaybeAccessor<boolean>;
}) {
    const tooltip = bind(item, 'tooltip-markup');
    const title = bind(item, 'title');
    const icon = bind(item, 'gicon');
    const menu = bind(item, 'menu-model');
    const actions = bind(item, 'action-group');
    const status = bind(item, 'status');

    return (
        <Gtk.MenuButton
            visible={visible}
            cssClasses={['circular']}
            tooltipMarkup={tooltip}
            ref={(self) => {
                effect(() => self.insert_action_group('dbusmenu', actions()));
                effect(() => {
                    const label = tooltip()
                        ?.replace(/<[^>]*>/g, '')
                        .trim();
                    self.update_property(
                        [Gtk.AccessibleProperty.LABEL],
                        [
                            new GObject.Value(
                                GObject.TYPE_STRING,
                                label || title() || 'System tray item'
                            ),
                        ]
                    );
                });
                usePopoverCleanup(self);
            }}
        >
            <Gtk.PopoverMenu
                slot="popover"
                cssClasses={['menu']}
                menuModel={menu}
                ref={(self) => {
                    self.connect('map', () => {
                        const child = self.get_child();
                        const surface = self.get_native()?.get_surface();
                        const monitor = surface?.get_display().get_monitor_at_surface(surface);
                        if (child instanceof Gtk.ScrolledWindow && monitor) {
                            child.maxContentHeight = Math.floor(monitor.geometry.height / 2);
                        }
                    });
                }}
            />
            <Gtk.Image
                visible={icon.as((value) => !!value)}
                gicon={icon}
                cssClasses={status.as((value) => (value === 2 ? ['needs-attention'] : []))}
            />
        </Gtk.MenuButton>
    );
}
