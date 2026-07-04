/**
 * MockNotification — standalone preview of the notification toast.
 *
 * Visually matches src/widget/common/notification.tsx but takes plain
 * props instead of AstalNotifd.Notification objects, so it works
 * in the standalone previewer without Astal services.
 */

import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import {IconNames, type IconName} from '#/lib/iconNames';

function relativeTime(unix: number): string {
    const now = GLib.DateTime.new_now_local();
    const then = GLib.DateTime.new_from_unix_local(unix);
    const diff = now.difference(then);
    const seconds = Number(diff.valueOf()) / 1_000_000;
    if (seconds < 10) return 'now';
    if (seconds < 60) return `${Math.floor(seconds)}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

interface MockNotificationProps {
    appName?: string;
    appIcon?: IconName;
    summary?: string;
    body?: string;
    time?: number;
    hasImage?: boolean;
    urgency?: 'normal' | 'critical' | 'low';
    showActions?: boolean;
    showProgress?: boolean;
}

export const MockNotification = (props: MockNotificationProps) => {
    const {
        appName = 'Spotify',
        appIcon = IconNames.applicationsMultimedia,
        summary = 'Now Playing',
        body = 'Bohemian Rhapsody — Queen',
        time = GLib.DateTime.new_now_local().to_unix(),
        hasImage = false,
        urgency = 'normal',
        showActions = true,
        showProgress = true,
    } = props;

    const isCritical = urgency === 'critical';
    const isLow = urgency === 'low';

    return (
        <Adw.Clamp widthRequest={360}>
            <Gtk.Box
                cssClasses={[
                    'card',
                    'frame',
                    'p-12',
                    'notification-card',
                    isCritical ? 'notification-critical' : '',
                    isLow ? 'dimmed' : '',
                ].filter(Boolean)}
                spacing={8}
                orientation={Gtk.Orientation.VERTICAL}
            >
                {/* ── Header: icon + summary + timestamp + close ── */}
                <Gtk.Box spacing={8}>
                    <Gtk.Image
                        pixelSize={24}
                        visible={!!appIcon}
                        iconName={appIcon}
                    />
                    <Gtk.Box
                        orientation={Gtk.Orientation.VERTICAL}
                        hexpand
                        spacing={2}
                    >
                        <Gtk.Box spacing={6}>
                            <Gtk.Label
                                wrap
                                hexpand
                                cssClasses={['title-4']}
                                label={summary}
                                xalign={0}
                            />
                            <Gtk.Label
                                cssClasses={['caption', 'numeric']}
                                label={relativeTime(time)}
                                valign={Gtk.Align.CENTER}
                            />
                        </Gtk.Box>
                        {appName ? (
                            <Gtk.Label
                                cssClasses={['caption', 'dimmed']}
                                label={appName}
                                xalign={0}
                            />
                        ) : null}
                    </Gtk.Box>
                    <Gtk.Button
                        halign={Gtk.Align.END}
                        valign={Gtk.Align.START}
                        cssClasses={[
                            'circular',
                            'flat',
                            isCritical ? 'destructive-action' : '',
                        ].filter(Boolean)}
                        onClicked={() =>
                            print('[MockNotification] close clicked')
                        }
                        iconName="window-close-symbolic"
                    />
                </Gtk.Box>

                {/* ── Body + optional image ── */}
                <Gtk.Box spacing={8}>
                    {hasImage ? (
                        <Gtk.Image
                            cssClasses={['notification-image']}
                            iconName="image-x-generic-symbolic"
                            pixelSize={64}
                            valign={Gtk.Align.START}
                        />
                    ) : null}
                    <Gtk.Label
                        wrap
                        hexpand
                        maxWidthChars={hasImage ? 20 : 30}
                        cssClasses={['body']}
                        label={body}
                        xalign={0}
                    />
                </Gtk.Box>

                {/* ── Progress bar (static, no auto-dismiss timer in mock) ── */}
                {showProgress && (
                    <Gtk.ProgressBar
                        fraction={0.65}
                        cssClasses={['notification-progress']}
                    />
                )}

                {/* ── Action buttons ── */}
                {showActions && (
                    <Gtk.Box cssClasses={['notification-actions']} spacing={4}>
                        <Gtk.Button
                            cssClasses={['flat', 'suggested-action']}
                            onClicked={() =>
                                print('[MockNotification] action: Reply')
                            }
                            label="Reply"
                        />
                        <Gtk.Button
                            cssClasses={['flat', 'suggested-action']}
                            onClicked={() =>
                                print('[MockNotification] action: Dismiss')
                            }
                            label="Dismiss"
                        />
                    </Gtk.Box>
                )}
            </Gtk.Box>
        </Adw.Clamp>
    ) as Gtk.Widget;
};
