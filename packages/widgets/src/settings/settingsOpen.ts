import type Adw from 'gi://Adw?version=1';
import {render} from '@gnim-js/gtk4';
import {getApp} from '@shade/services/appHandle';
import WindowManager from '@shade/services/state/windowManager';
import {createSettingsWindow} from './index';

let settingsWindow: Adw.Window | null = null;
let settingsDispose: (() => void) | null = null;

/**
 * Open (or toggle-focus) the settings window.
 *
 * Extracted from the widget barrel to eliminate the tray → barrel
 * circular dependency (tray.tsx → widget/index.tsx → quicksettings/ → tray).
 */
function disposeCurrentSettings() {
    const wm = WindowManager.get_default();
    const current = settingsWindow;
    settingsWindow = null;

    if (current && wm.settings === current) wm.setSettings(null);

    const dispose = settingsDispose;
    settingsDispose = null;
    dispose?.();
}

export function openSettings() {
    const wm = WindowManager.get_default();
    const existing = wm.settings;
    if (existing && existing.visible) {
        existing.present();
        return;
    }
    if (existing) {
        existing.close();
        if (wm.settings === existing) wm.setSettings(null);
    }
    disposeCurrentSettings();

    const dispose = render(() => createSettingsWindow(), getApp());
    const win = wm.settings;
    if (!win) {
        dispose();
        throw new Error('Settings window did not register with WindowManager');
    }

    settingsWindow = win;
    settingsDispose = dispose;
    win.connect('close-request', () => {
        if (settingsWindow === win) disposeCurrentSettings();
        return false;
    });
    win.present();
}
