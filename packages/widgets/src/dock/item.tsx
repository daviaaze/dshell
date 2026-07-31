import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import {onCleanup} from 'gnim';
import {useSettings} from '@shade/services/settings/index';
import {
    getAppList,
    exactQuery,
    launchDesktopFile,
} from '@shade/services/state/apps';
import {ActionButton} from '../common/actionButton';
import logger from '@shade/core/logger';

interface DockItemProps {
    desktopFile: string;
    clients: AstalHyprland.Client[];
    active: boolean;
    pinned: boolean;
}

export default ({desktopFile, clients, active, pinned}: DockItemProps) => {
    const {bar} = useSettings();

    const app =
        getAppList().find(a => a.entry === desktopFile) ||
        exactQuery(desktopFile.replace('.desktop', ''))?.[0];

    const iconName = app?.iconName || 'application-x-executable-symbolic';
    const running = clients.length > 0;

    const handleLeftClick = () => {
        if (running) {
            logger.debug('dock', `focus: ${desktopFile}`);
            clients[0].focus();
        } else if (pinned) {
            logger.debug('dock', `launch: ${desktopFile}`);
            launchDesktopFile(desktopFile);
        }
    };

    const handleClose = () => {
        logger.debug(
            'dock',
            `close: ${desktopFile} (${clients.length} windows)`
        );
        for (const client of clients) {
            client.kill();
        }
    };

    const handlePinToggle = () => {
        logger.info('dock', `${pinned ? 'unpin' : 'pin'}: ${desktopFile}`);
        const current = bar.dockPinnedApps();
        if (pinned) {
            bar.setDockPinnedApps(current.filter(d => d !== desktopFile));
        } else {
            bar.setDockPinnedApps([...current, desktopFile]);
        }
    };

    let popoverWidget: Gtk.Popover | null = null;

    const popoverNode = (
        <Gtk.Popover
            ref={self => { popoverWidget = self; }}
            cssClasses={['menu']}
            hasArrow={false}
        >
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={4}
                css={'padding: 8px;'}
            >
                <ActionButton
                    iconName="focus-windows-symbolic"
                    label="Focus"
                    visible={running}
                    onClicked={() => {
                        handleLeftClick();
                        popoverWidget?.popdown();
                    }}
                />
                <ActionButton
                    iconName="window-close-symbolic"
                    label="Close"
                    visible={running}
                    onClicked={() => {
                        handleClose();
                        popoverWidget?.popdown();
                    }}
                />
                <ActionButton
                    iconName={
                        pinned ? 'edit-delete-symbolic' : 'list-add-symbolic'
                    }
                    label={pinned ? 'Unpin' : 'Pin'}
                    onClicked={() => {
                        handlePinToggle();
                        popoverWidget?.popdown();
                    }}
                />
            </Gtk.Box>
        </Gtk.Popover>
    );

    let statusCssClasses: string[] = [];
    if (active) statusCssClasses = ['status-active'];
    else if (running) statusCssClasses = ['status-running'];

    return (
        <Gtk.Button
            ref={self => {
                if (!popoverWidget) return;
                popoverWidget.set_parent(self);
                bar.dockIconSize.subscribe(() => {
                    const firstChild = self.get_first_child();
                    if (firstChild instanceof Gtk.Image) {
                        firstChild.pixelSize = bar.dockIconSize();
                    }
                });
                const firstChild = self.get_first_child();
                if (firstChild instanceof Gtk.Image) {
                    firstChild.pixelSize = bar.dockIconSize();
                }
                onCleanup(() => {
                    popoverWidget?.popdown();
                    popoverWidget?.unparent();
                });
            }}
            cssClasses={['flat', 'circular']}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            onClicked={handleLeftClick}
            tooltipText={app?.name || desktopFile.replace('.desktop', '')}
        >
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={4}
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
            >
                <Gtk.Image
                    iconName={iconName}
                    pixelSize={bar.dockIconSize()}
                />
                <Gtk.Box
                    cssClasses={statusCssClasses}
                    visible={active || running}
                />
            </Gtk.Box>
            {popoverNode}
            <Gtk.GestureClick
                ref={self => {
                    self.set_button(Gdk.BUTTON_SECONDARY);
                    self.connect('pressed', () => {
                        if (popoverWidget) popoverWidget.popup();
                    });
                }}
            />
        </Gtk.Button>
    );
};
