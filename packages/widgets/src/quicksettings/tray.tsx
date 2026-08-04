import type Tray from 'gi://AstalTray';
import Gtk from 'gi://Gtk?version=4.0';
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
            onClicked={() => {
                bus.emit('shell:lock');
            }}
        />
    );

    const PowerButton = () => (
        <IconMenuButton icon="system-shutdown-symbolic" cssClasses={['destructive-action']}>
            <PowerMenu />
        </IconMenuButton>
    );

    const RotateButton = () => {
        const barCfg = barSettings();
        return (
            <IconButton
                icon="object-rotate-right-symbolic"
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
