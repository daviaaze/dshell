import logger from './logger';

/** Structural shape of a GIR linked-list node ({data, next} chain). */
interface GirListNode {
    data?: unknown;
    next?: GirListNode | null;
}

export function toArray<T>(list: unknown): T[] {
    if (!list) return [];
    if (Array.isArray(list)) return list as T[];
    const arr: T[] = [];
    let l = list as GirListNode | null;
    let totalCount = 0;
    let skippedCount = 0;
    while (l) {
        totalCount++;
        try {
            const item = (l.data !== undefined ? l.data : l) as T;
            if (item !== undefined && item !== null) {
                arr.push(item);
            }
            l = l.next ?? null;
        } catch {
            skippedCount++;
            logger.debug('gir', 'toArray: skipping item, GIR data unreadable');
            try {
                l = l?.next ?? null;
            } catch {
                break;
            }
        }
    }
    if (totalCount > 0 && skippedCount > 0) {
        logger.debug(
            'gir',
            `toArray: ${skippedCount}/${totalCount} items skipped`
        );
    }
    return arr;
}

export function listLength(list: unknown): number {
    if (!list) return 0;
    if (Array.isArray(list)) return list.length;
    let count = 0;
    let l = list as GirListNode | null;
    while (l) {
        count++;
        l = l.next ?? null;
    }
    return count;
}
