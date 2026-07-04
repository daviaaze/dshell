import Apps from 'gi://AstalApps';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import WindowManager from '#/lib/windowManager';
import GLib from 'gi://GLib?version=2.0';

export default ({application}: {application: Apps.Application}) => {
    // Create child content once per button instance to avoid
    // gtk_button_set_child assertion on re-render.
    let set = false;
    return (
        <Gtk.Button
            $={self => {
                if (set) return;
                set = true;
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
            cssClasses={['app-button']}
            onClicked={() => {
                WindowManager.get_default().applauncher!.visible = false;
                application.frequency += 1;
                GLib.spawn_command_line_async(
                    `uwsm-app -t service -- ${application.entry}`
                );
            }}
        />
    );
};
