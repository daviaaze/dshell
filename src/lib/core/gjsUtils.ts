import logger from '#/lib/logger';

export function toArray<T>(list: any): T[] {
    if (!list) return [];
    if (Array.isArray(list)) return list;
    const arr: T[] = [];
    let l = list;
    let totalCount = 0;
    let skippedCount = 0;
    while (l) {
        totalCount++;
        try {
            const item = l.data !== undefined ? l.data : l;
            if (item !== undefined && item !== null) {
                arr.push(item);
            }
            l = l.next;
        } catch {
            skippedCount++;
            logger.debug('gir', 'toArray: skipping item, GIR data unreadable');
            try {
                l = l.next;
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

export function listLength(list: any): number {
    if (!list) return 0;
    if (Array.isArray(list)) return list.length;
    let count = 0;
    let l = list;
    while (l) {
        count++;
        l = l.next;
    }
    return count;
}
