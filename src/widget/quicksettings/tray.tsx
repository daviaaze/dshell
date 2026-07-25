import Gtk from 'gi://Gtk?version=4.0';
import {bind, For} from 'gnim';
import {useSettings} from '#/lib/settings';
import Tray from 'gi://AstalTray';
import TrayService from '#/lib/services/desktop/trayService';
import ShellState from '#/lib/services/state/shellState';
import {PowerMenu} from '#/widget/common/powerMenu';
import {IconButton, IconMenuButton} from '#/widget/common/iconButton';
import {openSettings} from '#/widget';
import {usePopoverCleanup} from '#/widget/common/popoverCleanup';

export const TrayBox = () => {
    const tray = TrayService.get_default();

    const LockButton = () => (
        <IconButton
            icon="system-lock-screen-symbolic"
            onClicked={() => {
                ShellState.get_default().lock();
            }}
        />
    );

    const PowerButton = () => {
        const menu = PowerMenu();
        return (
            <IconMenuButton
                icon="system-shutdown-symbolic"
                cssClasses={['destructive-action']}
                popover={menu}
            />
        );
    };

    const RotateButton = () => {
        const barCfg = useSettings().bar;
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
                ShellState.get_default().closeQuickSettings();
            }}
        />
    );

    return (
        <Gtk.Box spacing={4} homogeneous halign={Gtk.Align.CENTER}>
            <For each={bind(tray, 'items')}>
                {(item: Tray.TrayItem) => (
                    <Gtk.MenuButton
                        cssClasses={['circular']}
                        ref={self => {
                            self.insert_action_group(
                                'dbusmenu',
                                item.actionGroup
                            );
                            usePopoverCleanup(self);
                        }}
                        popover={
                            (
                                <Gtk.PopoverMenu
                                    cssClasses={['menu']}
                                    menuModel={item.menuModel}
                                />
                            ) as any
                        }
                        tooltipMarkup={bind(item, 'tooltipMarkup')}
                    >
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
