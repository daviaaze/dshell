/**
 * Augment ImportMeta with gnim/GJS-specific properties.
 *
 * gnim passes module metadata via ImportMeta (name, domain, datadir)
 * which GJS exposes at runtime but are absent from the generated type
 * declarations. Without these augmentations every usage across the
 * codebase produces TS2339, which cascades into implicit-any noise.
 *
 * @see https://gjs-docs.gnome.org/
 */
interface ImportMeta {
    /** Module name — injected by gnim bundler. */
    name: string;
    /** Gettext domain — set via gnim's --domain flag. */
    domain: string;
    /** XDG data directory — resolved by gnim at build time. */
    datadir: string;
    /** Module version — injected by gnim bundler. */
    version: string;
}
