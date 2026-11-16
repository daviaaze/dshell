import type Tray from 'gi://AstalTray';
import {isTrayItemHidden, trayItemKey} from '../common/trayItem';
import {describe, expect, it, run} from './test-runner';

const item = (itemId: string, id: string, title: string): Tray.TrayItem =>
    ({itemId, id, title}) as Tray.TrayItem;

describe('tray item placement identity', () => {
    it('uses the app-defined protocol id rather than session item-id or display text', () => {
        const before = item(':1.1234/StatusNotifierItem', 'org.example.App', 'Old title');
        const after = item(':1.9876/StatusNotifierItem', 'org.example.App', 'New title');
        expect(trayItemKey(before)).toBe('org.example.App');
        expect(trayItemKey(after)).toBe('org.example.App');
        expect(isTrayItemHidden(after, ['org.example.App'])).toBeTruthy();
    });

    it('does not persist placement when the app-defined id is missing', () => {
        expect(trayItemKey(item('runtime-id', '', 'title'))).toBe('');
        expect(isTrayItemHidden(item('runtime-id', '', 'title'), ['runtime-id'])).toBeFalsy();
    });
    it('partitions identified apps exclusively between the bar and Quick Settings', () => {
        const appOnBar = item('session-1', 'org.example.App', 'App');
        const appInQuickSettings = item('session-2', 'org.example.Other', 'App');
        const hidden = ['org.example.Other'];
        expect(isTrayItemHidden(appOnBar, hidden)).toBeFalsy();
        expect(isTrayItemHidden(appInQuickSettings, hidden)).toBeTruthy();
    });
});

run(import.meta.url);
