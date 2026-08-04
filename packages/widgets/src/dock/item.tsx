import type AstalHyprland from 'gi://AstalHyprland?version=0.1';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import {barSettings} from '@shade/services/settings/bar.gschema';
import {exactQuery, getAppList, launchDesktopFile} from '@shade/services/state/apps';
import {onCleanup} from 'gnim';
import {ActionButton} from '../common/actionButton';

interface DockItemProps {
    desktopFile: string;
    clients: AstalHyprland.Client[];
    active: boolean;
    pinned: boolean;
}

/** Shared handle so the button ref can parent/popdown the popover. */
interface PopoverHolder {
    current: Gtk.Popover | null;
}

function handleLeftClick(
    desktopFile: string,
    clients: AstalHyprland.Client[],
    pinned: boolean,
    running: boolean
) {
    if (running) {
        logger.debug('dock', `focus: ${desktopFile}`);
        clients[0].focus();
    } else if (pinned) {
        logger.debug('dock', `launch: ${desktopFile}`);
        launchDesktopFile(desktopFile);
    }
}

function handleClose(desktopFile: string, clients: AstalHyprland.Client[]) {
    logger.debug('dock', `close: ${desktopFile} (${clients.length} windows)`);
    for (const client of clients) {
        client.kill();
    }
}

function handlePinToggle(
    bar: ReturnType<typeof barSettings>,
    desktopFile: string,
    pinned: boolean
) {
    logger.info('dock', `${pinned ? 'unpin' : 'pin'}: ${desktopFile}`);
    const current = bar.dockPinnedApps();
    if (pinned) {
        bar.setDockPinnedApps(current.filter((d) => d !== desktopFile));
    } else {
        bar.setDockPinnedApps([...current, desktopFile]);
    }
}

/** Right-click context menu: focus/close (when running) + pin toggle. */
function DockPopover({
    running,
    pinned,
    holder,
    onFocus,
    onClose,
    onPinToggle,
}: {
    running: boolean;
    pinned: boolean;
    holder: PopoverHolder;
    onFocus: () => void;
    onClose: () => void;
    onPinToggle: () => void;
}) {
    return (
        <Gtk.Popover
            ref={(self) => {
                holder.current = self;
            }}
            cssClasses={['menu']}
            hasArrow={false}
        >
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} css={'padding: 8px;'}>
                <ActionButton
                    iconName="focus-windows-symbolic"
                    label="Focus"
                    visible={running}
                    onClicked={() => {
                        onFocus();
                        holder.current?.popdown();
                    }}
                />
                <ActionButton
                    iconName="window-close-symbolic"
                    label="Close"
                    visible={running}
                    onClicked={() => {
                        onClose();
                        holder.current?.popdown();
                    }}
                />
                <ActionButton
                    iconName={pinned ? 'edit-delete-symbolic' : 'list-add-symbolic'}
                    label={pinned ? 'Unpin' : 'Pin'}
                    onClicked={() => {
                        onPinToggle();
                        holder.current?.popdown();
                    }}
                />
            </Gtk.Box>
        </Gtk.Popover>
    );
}

export default ({desktopFile, clients, active, pinned}: DockItemProps) => {
    const bar = barSettings();

    const app =
        getAppList().find((a) => a.entry === desktopFile) ||
        exactQuery(desktopFile.replace('.desktop', ''))?.[0];

    const iconName = app?.iconName || 'application-x-executable-symbolic';
    const running = clients.length > 0;

    const onFocus = () => handleLeftClick(desktopFile, clients, pinned, running);
    const onClose = () => handleClose(desktopFile, clients);
    const onPinToggle = () => handlePinToggle(bar, desktopFile, pinned);

    const holder: PopoverHolder = {current: null};

    let statusCssClasses: string[] = [];
    if (active) statusCssClasses = ['status-active'];
    else if (running) statusCssClasses = ['status-running'];

    return (
        <Gtk.Button
            ref={(self) => {
                const popover = holder.current;
                if (!popover) return;
                popover.set_parent(self);
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
                    popover.popdown();
                    popover.unparent();
                });
            }}
            cssClasses={['flat', 'circular']}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            onClicked={onFocus}
            tooltipText={app?.name || desktopFile.replace('.desktop', '')}
        >
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={4}
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
            >
                <Gtk.Image iconName={iconName} pixelSize={bar.dockIconSize()} />
                <Gtk.Box cssClasses={statusCssClasses} visible={active || running} />
            </Gtk.Box>
            <DockPopover
                running={running}
                pinned={pinned}
                holder={holder}
                onFocus={onFocus}
                onClose={onClose}
                onPinToggle={onPinToggle}
            />
            <Gtk.GestureClick
                ref={(self) => {
                    self.set_button(Gdk.BUTTON_SECONDARY);
                    self.connect('pressed', () => {
                        holder.current?.popup();
                    });
                }}
            />
        </Gtk.Button>
    );
};
