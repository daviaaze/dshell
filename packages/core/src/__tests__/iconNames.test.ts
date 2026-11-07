import Gtk from 'gi://Gtk?version=4.0';
import {IconNames} from '../iconNames';
import {describe, expect, it, run} from './test-runner';

describe('IconNames', () => {
    it('resolves built-in UI icons in Adwaita without requiring a display', () => {
        Gtk.init_check();
        const theme = new Gtk.IconTheme();
        theme.set_theme_name('Adwaita');
        theme.add_resource_path('/org/gtk/libgtk/icons/');
        // Moon phases are application assets, not part of the system theme.
        const missing = [...new Set(Object.values(IconNames))]
            .filter(name => !name.startsWith('moon-') && !theme.has_icon(name));
        expect(missing).toEqual([]);
    });
});

run();
