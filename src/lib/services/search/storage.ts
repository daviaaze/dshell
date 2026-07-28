/**
 * Frecency storage — persists launch frequency/recency data to GSettings.
 *
 * Data model:
 * ```ts
 * Record<string, { count: number, lastLaunched: number }>
 * ```
 * where key = desktop file ID (e.g. "firefox.desktop"),
 * count = lifetime launches,
 * lastLaunched = epoch ms of most recent launch.
 *
 * Max 500 entries; LRU eviction on overflow.
 */
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '../../core/logger';

// ── Types ──

export interface FrecencyEntry {
    count: number;
    lastLaunched: number;
}

type FrecencyData = Record<string, FrecencyEntry>;

// ── Constants ──

const SCHEMA_ID = 'com.caioasmuniz.shade_shell.launcher';
const KEY = 'frecency';
const MAX_ENTRIES = 500;
const DEBOUNCE_MS = 500;

// ── Storage ──

export class FrecencyStorage {
    #settings: Gio.Settings | null = null;
    #data: FrecencyData = {};
    #dirty = false;
    #debounceId: number | null = null;
    #loaded = false;

    constructor() {
        try {
            this.#settings = new Gio.Settings({schemaId: SCHEMA_ID});
        } catch {
            logger.warn(
                'frecency',
                `GSettings schema ${SCHEMA_ID} not found, using in-memory only`
            );
        }
    }

    /** Load data from GSettings. */
    load(): FrecencyData {
        if (this.#loaded) return this.#data;
        this.#loaded = true;

        if (this.#settings) {
            try {
                const raw = this.#settings.get_string(KEY);
                if (raw) {
                    this.#data = JSON.parse(raw) as FrecencyData;
                    // Validate and clean up
                    for (const [id, entry] of Object.entries(this.#data)) {
                        if (
                            typeof entry.count !== 'number' ||
                            typeof entry.lastLaunched !== 'number'
                        ) {
                            delete this.#data[id];
                        }
                    }
                }
            } catch (e) {
                logger.warn('frecency', 'failed to load frecency data:', e);
                this.#data = {};
            }
        }

        return this.#data;
    }

    /** Get a specific entry. */
    get(desktopId: string): FrecencyEntry | undefined {
        this.load();
        return this.#data[desktopId];
    }

    /** Get all data. */
    getAll(): FrecencyData {
        this.load();
        return this.#data;
    }

    /** Record a launch: increment count and update timestamp. */
    record(desktopId: string): void {
        this.load();

        const now = Date.now();
        const existing = this.#data[desktopId];
        if (existing) {
            existing.count++;
            existing.lastLaunched = now;
        } else {
            this.#data[desktopId] = {count: 1, lastLaunched: now};
        }

        // Enforce max entries — evict oldest
        const entries = Object.entries(this.#data);
        if (entries.length > MAX_ENTRIES) {
            entries.sort((a, b) => a[1].lastLaunched - b[1].lastLaunched);
            const toRemove = entries.length - MAX_ENTRIES;
            for (let i = 0; i < toRemove; i++) {
                delete this.#data[entries[i]![0]];
            }
        }

        this.#markDirty();
    }

    /** Remove an entry. */
    remove(desktopId: string): void {
        this.load();
        delete this.#data[desktopId];
        this.#markDirty();
    }

    /** Clear all frecency data. */
    clear(): void {
        this.#data = {};
        this.#markDirty();
        this.#flush(); // immediate
    }

    // ── Internals ──

    #markDirty(): void {
        this.#dirty = true;

        if (this.#debounceId !== null) {
            GLib.source_remove(this.#debounceId);
        }

        this.#debounceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            DEBOUNCE_MS,
            () => {
                this.#debounceId = null;
                this.#flush();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    #flush(): void {
        if (!this.#dirty || !this.#settings) return;
        this.#dirty = false;

        try {
            this.#settings.set_string(KEY, JSON.stringify(this.#data));
            this.#settings.apply();
        } catch (e) {
            logger.error('frecency', 'failed to save frecency data:', e);
        }
    }
}
