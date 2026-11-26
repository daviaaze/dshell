import type Apps from 'gi://AstalApps';
import type {ClipboardEntry} from '../clipboard/history';
import {searchHistory} from '../clipboard/history';
import {fuzzyQuery, getAppList} from '../state/apps';
import {FrecencyManager, rerankByBoost} from './frecency';

export type LauncherMode = 'apps' | 'clipboard';
export type ListItem = Apps.Application | ClipboardEntry;

export interface LauncherResult {
    mode: LauncherMode;
    items: ListItem[];
    frecencyHasData: boolean;
}

/**
 * Search across apps and clipboard history based on the query.
 *
 * - `>` prefix → clipboard search (uses history.ts directly)
 * - empty → all apps sorted by frecency
 * - otherwise → fuzzy app search re-ranked by frecency
 */
export function launcherSearch(query: string): LauncherResult {
    if (query.startsWith('>')) {
        const clipQuery = query.slice(1).trim();
        const items = clipQuery ? searchHistory(clipQuery) : searchHistory('');
        return {mode: 'clipboard', items, frecencyHasData: false};
    }

    if (query.trim() === '') {
        const fm = FrecencyManager.get_default();
        const items = fm.rankByFrecency(getAppList(), (app) => app.entry ?? app.name ?? '');
        return {mode: 'apps', items, frecencyHasData: fm.hasData};
    }

    const fm = FrecencyManager.get_default();
    const items = rerankByBoost(fuzzyQuery(query), (app) =>
        fm.getSearchBoost(app.entry ?? app.name ?? '')
    );
    return {mode: 'apps', items, frecencyHasData: fm.hasData};
}
