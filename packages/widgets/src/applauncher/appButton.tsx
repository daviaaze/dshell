import Apps from 'gi://AstalApps';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import WindowManager from '@shade/services/state/windowManager';
import {FrecencyManager} from '@shade/services/search/frecency';
import {launchApp} from '@shade/services/state/apps';

export default ({
    application,
    onClicked,
}: {
    application: Apps.Application;
    onClicked?: () => void;
}) => {
    return (
        <Gtk.Button
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            cssClasses={['app-button', 'flat']}
            onClicked={() => {
                // Record frecency before launching
                const desktopId = application.entry ?? application.name;
                if (desktopId) {
                    FrecencyManager.get_default().recordLaunch(desktopId);
                }
                if (onClicked) onClicked();
                WindowManager.get_default().applauncher!.visible = false;
                application.frequency += 1;
                launchApp(application);
            }}
        >
            <Gtk.Box spacing={8}>
                <Gtk.Image
                    iconName={application.iconName || ''}
                    pixelSize={48}
                />
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
                    <Gtk.Label
                        wrap
                        cssClasses={['title-2']}
                        label={application.name}
                        xalign={0}
                    />
                    <Gtk.Label
                        cssClasses={['body']}
                        label={application.description}
                        xalign={0}
                        maxWidthChars={25}
                        wrap
                    />
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Button>
    );
};
