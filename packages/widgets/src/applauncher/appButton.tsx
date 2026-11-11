import type Apps from 'gi://AstalApps';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import CompositorSettings from '@shade/services/compositor/store';
import {bus} from '@shade/services/bus';
import {launchApp} from '@shade/services/state/apps';
import WindowManager from '@shade/services/state/windowManager';

export default ({
    application,
    onClicked,
}: {
    application: Apps.Application;
    onClicked?: () => void;
}) => {
    const shortcutEnabled = generalSettings().launcherShortcutBadges();
    const shortcut = shortcutEnabled
        ? CompositorSettings.get_default().getLaunchShortcut(application.entry ?? application.name)
              ?.keys
        : undefined;
    return (
        <Gtk.Button
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            cssClasses={['app-button', 'flat']}
            onClicked={() => {
                // Record frecency before launching
                const desktopId = application.entry ?? application.name;
                if (desktopId) {
                    bus.emit('search:frecency:record', desktopId);
                }
                if (onClicked) onClicked();
                WindowManager.get_default().applauncher!.visible = false;
                application.frequency += 1;
                launchApp(application);
            }}
        >
            <Gtk.Box spacing={8}>
                <Gtk.Image iconName={application.iconName || ''} pixelSize={48} />
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
                    <Gtk.Label wrap cssClasses={['title-2']} label={application.name} xalign={0} />
                    <Gtk.Label
                        cssClasses={['body']}
                        label={application.description}
                        xalign={0}
                        maxWidthChars={25}
                        wrap
                    />
                    {shortcut && (
                        <Gtk.Label
                            cssClasses={['caption', 'dim-label']}
                            label={`Atalho: ${shortcut}`}
                            xalign={0}
                        />
                    )}
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Button>
    );
};
