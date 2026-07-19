// @ts-nocheck — pre-existing GI type gaps; see tsconfig.json for strict mode settings
import Apps from 'gi://AstalApps';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import WindowManager from '#/lib/services/state/windowManager';
import {FrecencyManager} from '#/lib/services/search/frecency';
import {useStyle} from '#/style/useStyle';
import GLib from 'gi://GLib?version=2.0';

export default ({
    application,
    onClicked,
}: {
    application: Apps.Application;
    onClicked?: () => void;
}) => {
    const appButtonStyle = useStyle({
        padding: '6px',
        'border-radius': '8px',
        background: 'transparent',
        '&:hover': {
            background: 'var(--shade-hover-bg)',
        },
        '&:active': {
            background: 'var(--shade-active-bg)',
        },
    });
    // Create child content once per button instance to avoid
    // gtk_button_set_child assertion on re-render.
    let set = false;
    return (
        <Gtk.Button
            $={self => {
                if (set) return;
                set = true;
                appButtonStyle.$(self);
                const icon = (
                    <Gtk.Image
                        iconName={application.iconName || ''}
                        pixelSize={48}
                    />
                );
                const label = (
                    <Gtk.Label
                        wrap
                        cssClasses={['title-2']}
                        label={application.name}
                        xalign={0}
                    />
                );
                const desc = (
                    <Gtk.Label
                        cssClasses={['body']}
                        label={application.description}
                        xalign={0}
                        maxWidthChars={25}
                        wrap
                    />
                );
                const textBox = (
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
                        {label}
                        {desc}
                    </Gtk.Box>
                );
                const box = (
                    <Gtk.Box spacing={8}>
                        {icon}
                        {textBox}
                    </Gtk.Box>
                );
                self.child = box;
            }}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            cssClasses={['app-button', appButtonStyle.class]}
            onClicked={() => {
                // Record frecency before launching
                const desktopId = application.entry ?? application.name;
                if (desktopId) {
                    FrecencyManager.get_default().recordLaunch(desktopId);
                }
                if (onClicked) onClicked();
                WindowManager.get_default().applauncher!.visible = false;
                application.frequency += 1;
                GLib.spawn_command_line_async(
                    `uwsm-app -t service -- ${application.entry}`
                );
            }}
        />
    );
};
