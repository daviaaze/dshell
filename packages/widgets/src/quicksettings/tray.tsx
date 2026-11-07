import type Tray from 'gi://AstalTray';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import TrayService from '@shade/services/desktop/trayService';
import {barSettings} from '@shade/services/settings/bar.gschema';
import {bind, effect, For} from 'gnim';
import {IconButton, IconMenuButton} from '../common/iconButton';
import {usePopoverCleanup} from '../common/popoverCleanup';
import {PowerMenu} from '../common/powerMenu';
import {openSettings} from '../settings/settingsOpen';

export const TrayBox = () => {
    const tray = TrayService.get_default();

    const LockButton = () => (
        <IconButton
            icon="system-lock-screen-symbolic"
            accessibleLabel="Lock screen"
            tooltipText="Lock screen"
            onClicked={() => {
                bus.emit('shell:lock');
            }}
        />
    );

    const PowerButton = () => (
        <IconMenuButton
            icon="system-shutdown-symbolic"
            accessibleLabel="Power options"
            tooltipText="Power options"
            cssClasses={['destructive-action']}
        >
            <PowerMenu />
        </IconMenuButton>
    );

    const RotateButton = () => {
        const barCfg = barSettings();
        return (
            <IconButton
                icon="object-rotate-right-symbolic"
                accessibleLabel="Rotate panel position"
                tooltipText="Rotate panel position"
                onClicked={() => {
                    if (barCfg.position() > 8) barCfg.setPosition(2);
                    else barCfg.setPosition(barCfg.position() * 2);
                }}
            />
        );
    };

    const SettingsButton = () => (
        <IconButton
            icon="preferences-system-symbolic"
            accessibleLabel="Open Settings"
            tooltipText="Open Settings"
            onClicked={() => {
                openSettings();
                bus.emit('shell:qs:close');
            }}
        />
    );

    return (
        <Gtk.Box spacing={4} homogeneous halign={Gtk.Align.CENTER}>
            <For each={bind(tray, 'items')}>
                {(item: Tray.TrayItem) => {
                    const tooltip = bind(item, 'tooltip-markup');
                    const title = bind(item, 'title');
                    const icon = bind(item, 'gicon');
                    const menu = bind(item, 'menu-model');
                    const actions = bind(item, 'action-group');
                    return (
                        <Gtk.MenuButton
                            cssClasses={['circular']}
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
                            tooltipMarkup={tooltip}
                        >
                            <Gtk.PopoverMenu
                                slot="popover"
                                ref={(self) => {
                                    self.connect('map', () => {
                                        const child = self.get_child();
                                        const surface = self.get_native()?.get_surface();
                                        const monitor = surface
                                            ?.get_display()
                                            .get_monitor_at_surface(surface);
                                        if (child instanceof Gtk.ScrolledWindow && monitor) {
                                            child.maxContentHeight = Math.floor(
                                                monitor.geometry.height / 2
                                            );
                                        }
                                    });
                                }}
                                cssClasses={['menu']}
                                menuModel={menu}
                            />
                            <Gtk.Image visible={icon.as((value) => !!value)} gicon={icon} />
                        </Gtk.MenuButton>
                    );
                }}
            </For>
            <SettingsButton />
            <RotateButton />
            <LockButton />
            <PowerButton />
        </Gtk.Box>
    );
};
