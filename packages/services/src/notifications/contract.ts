/** System-level events — do-not-disturb, etc. */
export interface SystemEvents {
    'system:dnd:toggle': void;
    'system:dnd:set': boolean;
    'system:dnd:changed': boolean;
}
