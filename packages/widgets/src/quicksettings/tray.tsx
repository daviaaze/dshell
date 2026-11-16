import type Tray from 'gi://AstalTray';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import TrayService from '@shade/services/desktop/trayService';
import {barSettings} from '@shade/services/settings/bar.gschema';
import {bind, For} from 'gnim';
import {IconButton, IconMenuButton} from '../common/iconButton';
import {PowerMenu} from '../common/powerMenu';
import {isTrayItemHidden, TrayItemButton} from '../common/trayItem';
import {openSettings} from '../settings/settingsOpen';

export const TrayBox = () => {
    const tray = TrayService.get_default();
    const bar = barSettings();

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
                    <TrayItemButton
                        item={item}
                        visible={bar.hiddenTrayItems.as((ids) => isTrayItemHidden(item, ids))}
                    />
                )}
            </For>
            <SettingsButton />
            <RotateButton />
            <LockButton />
            <PowerButton />
        </Gtk.Box>
    );
};
