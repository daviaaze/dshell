/**
 * Frecency Manager — frequency + recency scoring for app launcher.
 *
 * Combines launch frequency (all-time count) with recency (time since last
 * launch) to rank apps. Top apps appear first when the launcher opens with
 * an empty search query, and search results are boosted by their frecency.
 *
 * Scoring formula:
 *   recencyScore = exp(-(now - lastLaunched) / halfLifeMs)
 *   frecencyScore = log2(count + 1) * recencyScore
 *   finalSearchScore = fuzzyScore * (1 + boost * frecencyScore)
 */
import GObject, {getter, register, signal} from 'gnim/gobject';
import Gio from 'gi://Gio?version=2.0';
import logger from '#/lib/core/logger';
import {FrecencyStorage, type FrecencyEntry} from './storage';

// ── Constants ──

/** Recency half-life in milliseconds (7 days). */
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** How much frecency boosts search results. 0.5 = up to 50% boost. */
const SEARCH_BOOST = 0.5;

// ── Frecency Manager ──

@register({GTypeName: 'FrecencyManager'})
export class FrecencyManager extends GObject.Object {
    static readonly instance: FrecencyManager;
    static get_default() {
        if (!this.instance) this.instance = new FrecencyManager();
        return this.instance;
    }

    #storage: FrecencyStorage;
    #initialized = false;

    constructor() {
        super();
        this.#storage = new FrecencyStorage();
    }

    /** Initialize — call once during boot. */
    init(): void {
        if (this.#initialized) {
            logger.warn('frecency', 'already initialized');
            return;
        }
        this.#initialized = true;
        this.#storage.load();
        logger.debug(
            'frecency',
            `loaded ${Object.keys(this.#storage.getAll()).length} frecency entries`
        );
    }

    /**
     * Record a launch event.
     * @param desktopId - The .desktop file ID (e.g. "firefox.desktop").
     */
    recordLaunch(desktopId: string): void {
        this.#storage.record(desktopId);
        this.notify('changed');
    }

    /**
     * Get the frecency score for a desktop ID (0..1 range).
     */
    getScore(desktopId: string): number {
        const entry = this.#storage.get(desktopId);
        if (!entry) return 0;
        return this.#computeFrecency(entry);
    }

    /**
     * Get the top-N desktop IDs sorted by frecency score descending.
     */
    getTopApps(limit: number = 20): string[] {
        const data = this.#storage.getAll();
        const scored = Object.entries(data)
            .map(([id, entry]) => ({
                id,
                score: this.#computeFrecency(entry),
            }))
            .filter(e => e.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return scored.map(e => e.id);
    }

    /**
     * Get all frecency entries with their computed scores.
     */
    getAllScores(): Map<string, number> {
        const data = this.#storage.getAll();
        const map = new Map<string, number>();
        for (const [id, entry] of Object.entries(data)) {
            map.set(id, this.#computeFrecency(entry));
        }
        return map;
    }

    /**
     * Compute the frecency boost for a fuzzy search result.
     * Returns a multiplier (1 + boost * frecencyScore).
     */
    getSearchBoost(desktopId: string): number {
        const score = this.getScore(desktopId);
        return 1 + SEARCH_BOOST * score;
    }

    /** Clear all frecency data. */
    clear(): void {
        this.#storage.clear();
        this.notify('changed');
    }

    /** Emitted when frecency data changes. */
    @signal([])
    changed(): void {}

    /**
     * Check if frecency is available (has any entries).
     */
    @getter(Boolean)
    get hasData(): boolean {
        return Object.keys(this.#storage.getAll()).length > 0;
    }

    // ── Scoring ──

    #computeFrecency(entry: FrecencyEntry): number {
        const now = Date.now();
        const age = now - entry.lastLaunched;
        const recency = Math.exp(-age / HALF_LIFE_MS);
        const frequency = Math.log2(entry.count + 1);

        // Normalize frequency: log2(101) ≈ 6.7 for 100 launches
        const maxFreq = Math.log2(501); // ~8.97 for 500 launches
        const normalizedFreq = frequency / maxFreq;

        // Combine: recency (0..1) × frequency (~0..1)
        return recency * normalizedFreq;
    }
}