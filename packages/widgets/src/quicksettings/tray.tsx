import type Tray from 'gi://AstalTray';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import {bus} from '@shade/services/bus';
import TrayService from '@shade/services/desktop/trayService';
import {barSettings} from '@shade/services/settings/bar.gschema';
import {bind, For} from 'gnim';
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
                {(item: Tray.TrayItem) => (
                    <Gtk.MenuButton
                        cssClasses={['circular']}
                        ref={(self) => {
                            self.insert_action_group('dbusmenu', item.actionGroup);
                            const label = item.tooltipMarkup?.replace(/<[^>]*>/g, '').trim();
                            self.update_property(
                                [Gtk.AccessibleProperty.LABEL],
                                [
                                    new GObject.Value(
                                        GObject.TYPE_STRING,
                                        label || 'System tray item'
                                    ),
                                ]
                            );
                            usePopoverCleanup(self);
                        }}
                        tooltipMarkup={bind(item, 'tooltip-markup')}
                    >
                        <Gtk.PopoverMenu
                            slot="popover"
                            cssClasses={['menu']}
                            menuModel={item.menuModel}
                        />
                        <Gtk.Image visible={!!item.gicon} gicon={item.gicon} />
                    </Gtk.MenuButton>
                )}
            </For>
            <SettingsButton />
            <RotateButton />
            <LockButton />
            <PowerButton />
        </Gtk.Box>
    );
};

