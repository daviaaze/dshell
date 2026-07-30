import {createRoot} from 'gnim';
import WindowManager from '../../lib/services/state/windowManager';
import {createSettingsWindow} from './index';

let settingsDispose: (() => void) | null = null;

/**
 * Open (or toggle-focus) the settings window.
 *
 * Extracted from the widget barrel to eliminate the tray → barrel
 * circular dependency (tray.tsx → widget/index.tsx → quicksettings/ → tray).
 */
export function openSettings() {
    const wm = WindowManager.get_default();
    const existing = wm.settings;
    if (existing && existing.visible) {
        existing.present();
        return;
    }
    if (existing) {
        existing.close();
        wm.setSettings(null);
    }
    // Dispose previous scope — unsubscribes settings-page subscriptions
    settingsDispose?.();
    settingsDispose = null;
    const win = createRoot(dispose => {
        settingsDispose = dispose;
        return createSettingsWindow();
    });
    wm.setSettings(win);
    win.present();
}
