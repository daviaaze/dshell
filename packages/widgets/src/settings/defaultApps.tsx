import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';

interface AppCategory {
    label: string;
    mimeType: string;
}

const CATEGORIES: AppCategory[] = [
    {label: 'Web Browser', mimeType: 'x-scheme-handler/http'},
    {label: 'Email Client', mimeType: 'x-scheme-handler/mailto'},
    {label: 'Music Player', mimeType: 'audio/*'},
    {label: 'Video Player', mimeType: 'video/*'},
    {label: 'Photo Viewer', mimeType: 'image/*'},
    {label: 'Text Editor', mimeType: 'text/plain'},
    {label: 'File Manager', mimeType: 'inode/directory'},
    {label: 'Terminal', mimeType: 'x-scheme-handler/terminal'},
];

export default () => {
    const group = new Adw.PreferencesGroup({
        title: 'Default Applications',
        description: 'Choose default apps for common actions',
    });

    CATEGORIES.forEach((category) => {
        const apps = Gio.AppInfo.get_all_for_type(category.mimeType);
        const defaultApp = Gio.AppInfo.get_default_for_type(category.mimeType, false);

        const row = new Adw.ComboRow({title: category.label});
        const model = new Gtk.StringList();

        apps.forEach((app) => {
            model.append(app.get_display_name() || 'Unknown');
        });
        row.model = model;

        if (defaultApp) {
            const defaultIndex = apps.findIndex((app) => app.equal(defaultApp));
            if (defaultIndex >= 0) row.selected = defaultIndex;
        }

        row.connect('notify::selected', () => {
            const selectedApp = apps[row.selected];
            if (selectedApp) {
                selectedApp.set_as_default_for_type(category.mimeType);
            }
        });

        group.add(row);
    });

    return group;
};
