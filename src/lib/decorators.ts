/**
 * Thin re-export of gnim's GObject property decorators.
 *
 * The real type fix lives in `src/types/gnim-overrides.d.ts`, which
 * overrides gnim's TS5-era decorator types with TS6-compatible ones
 * (decoupling the GObject ParamSpec type from the getter's return type).
 *
 * This barrel exists so internal code imports from `#/lib/decorators`
 * instead of reaching into `gnim/gobject` directly, providing a single
 * seam for future decorator-related changes.
 */
export {getter, setter} from 'gnim/gobject';
