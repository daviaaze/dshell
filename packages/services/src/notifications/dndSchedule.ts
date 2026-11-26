/**
 * Whether `hour` falls inside the daily Do Not Disturb window `[start, end)`.
 *
 * `start < end` is a same-day window, `start > end` crosses midnight, and
 * `start === end` is an empty window that never enables Do Not Disturb.
 */
export function isHourInDndWindow(hour: number, start: number, end: number): boolean {
    if (start === end) return false;
    return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
