import Gio from 'gi://Gio';
import GLib from 'gi://GLib?version=2.0';
import {Object, register, property} from 'gnim/gobject';
import logger from '../../core/logger';
import {getNotifdSafe} from './guard';
import {readFile} from '../../core/file';
import {Accessor} from 'gnim';

const CACHE_DIR = `${GLib.get_user_cache_dir()}/shade`;
const HISTORY_FILE = `${CACHE_DIR}/notifications.json`;

export interface HistoryEntry {
    id: number;
    appName: string;
    appIcon: string;
    summary: string;
    body: string;
    time: number;
}

function loadHistory(): HistoryEntry[] {
    try {
        const text = readFile(HISTORY_FILE);
        return JSON.parse(text);
    } catch {
        return [];
    }
}

let savePending = false;

function saveHistory(history: HistoryEntry[]) {
    if (savePending) return;
    savePending = true;
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        savePending = false;
        try {
            const dir = Gio.File.new_for_path(CACHE_DIR);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }
            GLib.file_set_contents(
                HISTORY_FILE,
                new TextEncoder().encode(JSON.stringify(history))
            );
        } catch (e) {
            logger.error('history', 'save failed:', e);
        }
        return GLib.SOURCE_REMOVE;
    });
}

@register
export default class NotificationHistory extends Object {
    static instance: NotificationHistory;
    static get_default() {
        if (!this.instance) this.instance = new NotificationHistory();
        return this.instance;
    }

    #history: HistoryEntry[] = [];
    #limit = 100;
    #ignoredApps: string[] = [];
    #notifdHandlerId = 0;

    @property
    get history() {
        return this.#history;
    }

    init(settings: {
        notificationHistoryLimit: Accessor<number>;
        notificationIgnoredApps: Accessor<string[]>;
    }) {
        this.#limit = settings.notificationHistoryLimit() || 100;
        this.#ignoredApps =
            settings.notificationIgnoredApps()?.map(a => a.toLowerCase()) || [];

        settings.notificationHistoryLimit.subscribe(() => {
            const newLimit = settings.notificationHistoryLimit();
            if (newLimit !== this.#limit) {
                this.setLimit(newLimit);
            }
        });

        settings.notificationIgnoredApps.subscribe(() => {
            const newApps =
                settings.notificationIgnoredApps()?.map(a => a.toLowerCase()) ||
                [];
            this.#ignoredApps = newApps;
        });
    }

    constructor() {
        super();
        this.#history = loadHistory();

        // Defer Notifd init to avoid blocking main loop for 25s
        // when another notification daemon is already registered.
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#initNotifd();
            return GLib.SOURCE_REMOVE;
        });
    }

    #initNotifd() {
        const notifd = getNotifdSafe();
        if (!notifd) return;
        this.#notifdHandlerId = notifd.connect('notified', (_, id) => {
            const n = notifd.get_notification(id);
            if (!n) return;
            if (this.#ignoredApps.includes(n.appName.toLowerCase())) return;
            this.add({
                id: n.id,
                appName: n.appName,
                appIcon: n.appIcon,
                summary: n.summary,
                body: n.body,
                time: n.time,
            });
        });
    }

    add(entry: HistoryEntry) {
        // Avoid duplicates by ID
        this.#history = this.#history.filter(h => h.id !== entry.id);
        this.#history.unshift(entry);
        if (this.#history.length > this.#limit) {
            this.#history = this.#history.slice(0, this.#limit);
        }
        saveHistory(this.#history);
        this.notify('history');
    }

    clear() {
        this.#history = [];
        saveHistory(this.#history);
        this.notify('history');
    }

    remove(id: number) {
        this.#history = this.#history.filter(h => h.id !== id);
        saveHistory(this.#history);
        this.notify('history');
    }

    setLimit(limit: number) {
        this.#limit = limit;
        if (this.#history.length > this.#limit) {
            this.#history = this.#history.slice(0, this.#limit);
            saveHistory(this.#history);
            this.notify('history');
        }
    }

    setIgnoredApps(apps: string[]) {
        this.#ignoredApps = apps.map(a => a.toLowerCase());
    }

    dispose() {
        if (this.#notifdHandlerId !== 0) {
            const notifd = getNotifdSafe();
            if (notifd) {
                try {
                    notifd.disconnect(this.#notifdHandlerId);
                } catch {
                    /* ignore */
                }
            }
            this.#notifdHandlerId = 0;
        }
    }
}
