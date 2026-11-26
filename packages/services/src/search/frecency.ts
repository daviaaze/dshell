/**
 * Frecency Manager — frequency + recency scoring for app launcher.
 *
 * Combines launch frequency (all-time count) with recency (time since last
 * launch) to rank apps. Top apps appear first when the launcher opens with
 * an empty search query, and search results are boosted by their frecency.
 *
 * Scoring formula:
 *   recencyScore = 2^(-(now - lastLaunched) / halfLifeMs)
 *   frecencyScore = log2(count + 1) / log2(MAX_COUNT + 1) * recencyScore
 *   finalSearchScore = fuzzyRankScore * (1 + SEARCH_BOOST * frecencyScore)
 *
 * `fuzzyRankScore` is derived from the position in AstalApps' fuzzy-sorted
 * result list (1 for the best match, falling linearly), so a launch history
 * can reorder close matches but cannot lift a weak match above a strong one.
 */

import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Object as GObject, property, register, signal} from 'gnim/gobject';
import {bus} from '../bus';
import {type FrecencyEntry, FrecencyStorage} from './storage';

// ── Constants ──

/** Recency half-life in milliseconds (7 days). */
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** How much frecency boosts search results. 0.5 = up to 50% boost. */
const SEARCH_BOOST = 0.5;

/** Launch count that maps to a normalized frequency of 1. */
const MAX_COUNT = 500;

/** Frecency of one entry in 0..1: normalized log frequency times a true half-life decay. */
export function computeFrecency(entry: FrecencyEntry, now: number): number {
    const age = Math.max(0, now - entry.lastLaunched);
    const recency = 2 ** (-age / HALF_LIFE_MS);
    const frequency = Math.log2(entry.count + 1) / Math.log2(MAX_COUNT + 1);
    return recency * frequency;
}

/**
 * Re-rank fuzzy results (best first) by `rankScore * boost`, where rankScore falls
 * linearly from 1 for the first item. Ties keep the fuzzy order.
 */
export function rerankByBoost<T>(items: T[], boostOf: (item: T) => number): T[] {
    const n = items.length;
    return items
        .map((item, index) => ({item, score: ((n - index) / n) * boostOf(item)}))
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item);
}

// ── Frecency Manager ──

@register
export class FrecencyManager extends GObject {
    private static instance: FrecencyManager;
    static get_default() {
        if (!FrecencyManager.instance) FrecencyManager.instance = new FrecencyManager();
        return FrecencyManager.instance;
    }

    #storage: FrecencyStorage;
    #initialized = false;
    #busInitialized = false;

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
        this.#initBus();
    }

    #initBus(): void {
        if (this.#busInitialized) return;
        this.#busInitialized = true;
        bus.on('search:frecency:record', (desktopId) => this.recordLaunch(desktopId));
    }

    /**
     * Record a launch event.
     * @param desktopId - The .desktop file ID (e.g. "firefox.desktop").
     */
    recordLaunch(desktopId: string): void {
        this.#storage.record(desktopId);
        this.changed();
    }

    /**
     * Get the frecency score for a desktop ID (0..1 range).
     */
    getScore(desktopId: string): number {
        const entry = this.#storage.get(desktopId);
        if (!entry) return 0;
        return computeFrecency(entry, Date.now());
    }

    /**
     * Get all frecency entries with their computed scores.
     */
    getAllScores(): Map<string, number> {
        const data = this.#storage.getAll();
        const now = Date.now();
        const map = new Map<string, number>();
        for (const [id, entry] of Object.entries(data)) {
            map.set(id, computeFrecency(entry, now));
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

    /**
     * Rank items by frecency score (highest first).
     * Items with frecency data appear first in score order, followed by
     * unscored items in their original order.
     *
     * @param items - Items to rank.
     * @param getId - Extracts a desktop ID from each item.
     * @returns Items sorted by frecency (scored first, then unscored).
     */
    rankByFrecency<T>(items: T[], getId: (item: T) => string): T[] {
        const scores = this.getAllScores();
        const scored: {item: T; score: number}[] = [];
        const unscored: T[] = [];

        for (const item of items) {
            const id = getId(item);
            const score = scores.get(id) ?? 0;
            if (score > 0) {
                scored.push({item, score});
            } else {
                unscored.push(item);
            }
        }

        scored.sort((a, b) => b.score - a.score);

        return [...scored.map((s) => s.item), ...unscored];
    }

    /** Clear all frecency data. */
    clear(): void {
        this.#storage.clear();
        this.changed();
    }

    /** Emitted when frecency data changes. */
    @signal
    changed(): void {}

    /**
     * Check if frecency is available (has any entries).
     */
    @property
    get hasData(): boolean {
        return Object.keys(this.#storage.getAll()).length > 0;
    }
}

defineService({name: 'FrecencyManager', service: FrecencyManager.get_default()});
