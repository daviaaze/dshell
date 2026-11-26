import type Apps from 'gi://AstalApps';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {bus} from '@shade/services/bus';
import CompositorSettings from '@shade/services/compositor/store';
import {launchApp} from '@shade/services/state/apps';
import WindowManager from '@shade/services/state/windowManager';
import {type Accessor, computed} from 'gnim';

/** Close the launcher, record the launch for frecency ranking and start the app. */
export function launchFromLauncher(application: Apps.Application) {
    const desktopId = application.entry ?? application.name;
    if (desktopId) {
        bus.emit('search:frecency:record', desktopId);
    }
    const launcher = WindowManager.get_default().applauncher;
    if (launcher) launcher.visible = false;
    application.frequency += 1;
    launchApp(application);
}

export default ({
    application,
    highlighted,
}: {
    application: Apps.Application;
    /** True for the row that Enter will launch. */
    highlighted: Accessor<boolean>;
}) => {
    const shortcutEnabled = generalSettings().launcherShortcutBadges();
    const shortcut = shortcutEnabled
        ? CompositorSettings.get_default().getLaunchShortcut(application.entry ?? application.name)
              ?.keys
        : undefined;
    return (
        <Gtk.Button
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            cssClasses={computed(() =>
                highlighted()
                    ? ['app-button', 'flat', 'app-button-primary']
                    : ['app-button', 'flat']
            )}
            onClicked={() => launchFromLauncher(application)}
        >
            <Gtk.Box spacing={8}>
                <Gtk.Image iconName={application.iconName || ''} pixelSize={48} />
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
                    <Gtk.Label wrap cssClasses={['title-2']} label={application.name} xalign={0} />
                    <Gtk.Label
                        cssClasses={['body']}
                        label={application.description}
                        tooltipText={application.description}
                        xalign={0}
                        maxWidthChars={40}
                        ellipsize={Pango.EllipsizeMode.END}
                    />
                    {shortcut && (
                        <Gtk.Label
                            cssClasses={['caption', 'dimmed']}
                            label={`Atalho: ${shortcut}`}
                            xalign={0}
                        />
                    )}
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Button>
    );
};
