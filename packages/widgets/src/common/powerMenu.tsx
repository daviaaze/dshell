import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import {computed, createState} from 'gnim';
import {ActionButton} from './actionButton';

const DESTRUCTIVE_ACTIONS = ['logout', 'reboot', 'poweroff'] as const;
const CONFIRM_TIMEOUT_MS = 3000;

const LABELS: Record<string, string> = {
    logout: 'Log Out',
    reboot: 'Reboot',
    poweroff: 'Power Off',
    suspend: 'Suspend',
    lock: 'Lock',
};

const CONFIRM_LABELS: Record<string, string> = {
    logout: 'Confirm Log Out?',
    reboot: 'Confirm Reboot?',
    poweroff: 'Confirm Power Off?',
};

export const PowerMenu = () => {
    const [pendingAction, setPendingAction] = createState<string | null>(null);

    const handleClick = (action: string) => {
        if (!DESTRUCTIVE_ACTIONS.includes(action as (typeof DESTRUCTIVE_ACTIONS)[number])) {
            // Non-destructive action: execute immediately
            bus.emit(`power:cmd:${action}` as 'power:cmd:logout' | 'power:cmd:suspend');
            return;
        }

        if (pendingAction() === action) {
            // Confirm and execute
            bus.emit(`power:cmd:${action}` as 'power:cmd:logout' | 'power:cmd:reboot' | 'power:cmd:poweroff');
        } else {
            setPendingAction(action);
            GLib.timeout_add(CONFIRM_TIMEOUT_MS, GLib.PRIORITY_DEFAULT, () => {
                setPendingAction(null);
                return GLib.SOURCE_REMOVE;
            });
        }
    };

    const labelFor = (action: string) =>
        computed(() => {
            const pending = pendingAction();
            if (pending === action) return CONFIRM_LABELS[action] ?? LABELS[action];
            return LABELS[action];
        });

    const cssFor = (action: string) =>
        computed(() => {
            const pending = pendingAction();
            if (pending === action) return ['flat', 'suggested-action'];
            if (pending !== null) return ['flat', 'dim-label'];
            return ['flat'];
        });

    const hideWhenPending = computed(() => pendingAction() === null);

    return (
        <Gtk.Popover cssClasses={['menu']}>
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                <ActionButton
                    iconName="system-lock-screen-symbolic"
                    label={labelFor('lock')}
                    onClicked={() => handleClick('lock')}
                    visible={hideWhenPending}
                />
                <ActionButton
                    iconName="system-log-out-symbolic"
                    label={labelFor('logout')}
                    cssClasses={cssFor('logout')}
                    onClicked={() => handleClick('logout')}
                />
                <ActionButton
                    iconName="media-playback-pause-symbolic"
                    label={labelFor('suspend')}
                    onClicked={() => handleClick('suspend')}
                    visible={hideWhenPending}
                />
                <ActionButton
                    iconName="system-reboot-symbolic"
                    label={labelFor('reboot')}
                    cssClasses={cssFor('reboot')}
                    onClicked={() => handleClick('reboot')}
                />
                <ActionButton
                    iconName="system-shutdown-symbolic"
                    label={labelFor('poweroff')}
                    destructive
                    cssClasses={cssFor('poweroff')}
                    onClicked={() => handleClick('poweroff')}
                />
            </Gtk.Box>
        </Gtk.Popover>
    );
};
