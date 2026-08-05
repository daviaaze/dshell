# GTK4 + libadwaita Theming Reference

This document catalogs all native theming primitives available for widget
styling. **No custom `--shade-*` properties are needed** — everything below
is provided by GTK4 and libadwaita automatically.

---

## Quick Reference

| Need | Use |
|------|-----|
| Window background | `.background` class or `--window-bg-color` |
| Card / surface | `.card` class or `--card-bg-color` |
| Accent color | `.accent` class or `--accent-bg-color` |
| Error color | `.error` class or `--error-bg-color` |
| Success color | `.success` class or `--success-bg-color` |
| Warning color | `.warning` class or `--warning-bg-color` |
| Dimmed/secondary text | `.dimmed` class or `--dim-opacity` |
| Title text | `.title-1` through `.title-4` |
| Heading text | `.heading` |
| Body text | `.body` |
| Caption / sub-text | `.caption` |
| Monospace code | `.monospace` |
| Tabular numbers | `.numeric` |
| Border/frame | `.frame` class or `--border-color` |
| Flat button | `.flat` class |
| Suggested action button | `.suggested-action` class |
| Destructive action button | `.destructive-action` class |
| Round button | `.circular` class |
| Pill button | `.pill` class |
| Linked controls group | `.linked` class |
| Toolbar | `.toolbar` class |
| Spacer in toolbar | `.spacer` class |
| Boxed list | `.boxed-list` class |

---

## CSS Custom Properties (Variables)

### Accent Colors

Used across many widgets to indicate importance, interactivity, or active
state. Override `--accent-bg-color` to change the app-wide accent; the
derived variables follow automatically.

| Variable | Default (Light) | Default (Dark) | Purpose |
|----------|----------------|----------------|---------|
| `--accent-bg-color` | `#3584e4` | `#3584e4` | Accent background |
| `--accent-fg-color` | `#ffffff` | `#ffffff` | Text on accent |
| `--accent-color` | derived | derived | Standalone accent (text on neutral) |

Named accent alternatives (override `--accent-bg-color` with one of these):

| Variable | Value |
|----------|-------|
| `--accent-blue` | `#3584e4` |
| `--accent-teal` | `#2190a4` |
| `--accent-green` | `#3a944a` |
| `--accent-yellow` | `#c88800` |
| `--accent-orange` | `#ed5b00` |
| `--accent-red` | `#e62d42` |
| `--accent-pink` | `#d56199` |
| `--accent-purple` | `#9141ac` |
| `--accent-slate` | `#6f8396` |

### Destructive Colors

For dangerous actions (delete, remove). Used with `.destructive-action`.

| Variable | Light | Dark |
|----------|-------|------|
| `--destructive-bg-color` | `#e01b24` | `#c01c28` |
| `--destructive-fg-color` | `#ffffff` | `#ffffff` |
| `--destructive-color` | `#c30000` | `#ff938c` |

### Success Colors

Used with `.success` or `GtkLevelBar` high offset.

| Variable | Light | Dark |
|----------|-------|------|
| `--success-bg-color` | `#2ec27e` | `#26a269` |
| `--success-fg-color` | `#ffffff` | `#ffffff` |
| `--success-color` | `#007c3d` | `#78e9ab` |

### Warning Colors

Used with `.warning` or `GtkLevelBar` low offset.

| Variable | Light | Dark |
|----------|-------|------|
| `--warning-bg-color` | `#e5a50a` | `#cd9309` |
| `--warning-fg-color` | `rgb(0 0 0 / 80%)` | `rgb(0 0 0 / 80%)` |
| `--warning-color` | `#905400` | `#ffc252` |

### Error Colors

Used with `.error`.

| Variable | Light | Dark |
|----------|-------|------|
| `--error-bg-color` | `#e01b24` | `#c01c28` |
| `--error-fg-color` | `#ffffff` | `#ffffff` |
| `--error-color` | `#c30000` | `#ff938c` |

### Window Colors

Default for `GtkWindow` and `.background`.

| Variable | Light | Dark |
|----------|-------|------|
| `--window-bg-color` | `#fafafb` | `#222226` |
| `--window-fg-color` | `rgb(0 0 6 / 80%)` | `#ffffff` |

### View Colors

Used in `GtkTextView` and `.view`.

| Variable | Light | Dark |
|----------|-------|------|
| `--view-bg-color` | `#ffffff` | `#1d1d20` |
| `--view-fg-color` | `rgb(0 0 6 / 80%)` | `#ffffff` |

### Card Colors

Used for cards, boxed lists, and `.card`.

| Variable | Light | Dark |
|----------|-------|------|
| `--card-bg-color` | `#ffffff` | `rgb(255 255 255 / 8%)` |
| `--card-fg-color` | `rgb(0 0 6 / 80%)` | `#ffffff` |
| `--card-shade-color` | `rgb(0 0 6 / 7%)` | `rgb(0 0 6 / 36%)` |

### Header Bar Colors

Used in `AdwHeaderBar` and similar widgets.

| Variable | Light | Dark |
|----------|-------|------|
| `--headerbar-bg-color` | `#ffffff` | `#2e2e32` |
| `--headerbar-fg-color` | `rgb(0 0 6 / 80%)` | `#ffffff` |
| `--headerbar-border-color` | `rgb(0 0 6 / 80%)` | `#ffffff` |
| `--headerbar-backdrop-color` | `#fafafb` | `#222226` |
| `--headerbar-shade-color` | `rgb(0 0 6 / 12%)` | `rgb(0 0 6 / 36%)` |

### Sidebar Colors

Used for sidebars (since 1.4).

| Variable | Light | Dark |
|----------|-------|------|
| `--sidebar-bg-color` | `#ebebed` | `#2e2e32` |
| `--sidebar-fg-color` | `rgb(0 0 6 / 80%)` | `#ffffff` |
| `--sidebar-backdrop-color` | `#f2f2f4` | `#28282c` |
| `--sidebar-shade-color` | `rgb(0 0 6 / 7%)` | `rgb(0 0 6 / 25%)` |

### Popover Colors

Used for `GtkPopover`.

| Variable | Light | Dark |
|----------|-------|------|
| `--popover-bg-color` | `#ffffff` | `#36363a` |
| `--popover-fg-color` | `rgb(0 0 6 / 80%)` | `#ffffff` |

### Dialog Colors

Used for `AdwAlertDialog` (since 1.2).

| Variable | Light | Dark |
|----------|-------|------|
| `--dialog-bg-color` | `#fafafb` | `#36363a` |
| `--dialog-fg-color` | `rgb(0 0 6 / 80%)` | `#ffffff` |

### Miscellaneous Colors

| Variable | Light | Dark | Purpose |
|----------|-------|------|---------|
| `--shade-color` | `rgb(0 0 6 / 7%)` | `rgb(0 0 6 / 25%)` | Scroll undershoots, transitions |
| `--scrollbar-outline-color` | `#ffffff` | `rgb(0 0 6 / 50%)` | Overlay scrollbar visibility |
| `--border-color` | `color-mix(...)` | `color-mix(...)` | Auto from `currentColor` + `--border-opacity` |

### Opacity Variables

| Variable | Regular | High Contrast |
|----------|---------|---------------|
| `--border-opacity` | `15%` | `50%` |
| `--dim-opacity` | `55%` | `90%` |
| `--disabled-opacity` | `50%` | `40%` |

### Radius

| Variable | Value | Purpose |
|----------|-------|---------|
| `--window-radius` | `15px` | Matches current window corner radius (updates for maximized/fullscreen) |

### Font Variables

| Variable | Example |
|----------|---------|
| `--document-font-family` | Adwaita Sans |
| `--document-font-size` | 12pt |
| `--monospace-font-family` | Adwaita Mono |
| `--monospace-font-size` | 11pt |

### Palette Colors

Full GNOME color palette (5 shades each of blue, green, yellow, orange,
red, purple, brown, light, dark). Use for custom color needs.

Example: `--blue-3` = `#3584e4`, `--red-1` = `#f66151`, `--dark-3` = `#3d3846`.

---

## Style Classes

### Button Classes

| Class | Effect |
|-------|--------|
| `.suggested-action` | Accent-colored button (primary action) |
| `.destructive-action` | Red/danger button |
| `.flat` | No background until hover |
| `.raised` | Regular appearance (default outside toolbars) |
| `.circular` | Round button (icon or 1-2 chars) |
| `.pill` | Pill-shaped button |
| `.opaque` | Opaque background (deprecated — use `.suggested-action` instead) |

### Toggle Group Classes

| Class | Effect |
|-------|--------|
| `.flat` | Flat button appearance |
| `.round` | Rounded group + toggles |

### Container Classes

| Class | Effect |
|-------|--------|
| `.linked` | Children appear as a single grouped control |
| `.toolbar` | Flat buttons, 6px spacing/margins |
| `.spacer` | Invisible separator (for toolbars) |
| `.boxed-list` | `GtkListBox` as a card with rows |
| `.boxed-list-separate` | Each row is a separate card |
| `.card` | Card appearance (background + rounded corners) |
| `.background` | `--window-bg-color` background |
| `.view` | `--view-bg-color` background |
| `.frame` | `1px solid var(--border-color)` border |
| `.navigation-sidebar` | Rounded padded list items, neutral selection |
| `.compact` | Reduced size (for `AdwStatusPage`) |
| `.menu` | Menu appearance (for `GtkPopover` with list) |
| `.inline` | Neutral background (for search bars, tab bars) |
| `.devel` | Striped header bar (for nightly apps) |

### Color Classes

| Class | Color |
|-------|-------|
| `.accent` | Accent color |
| `.success` | Success (green) color |
| `.warning` | Warning (yellow) color |
| `.error` | Error (red) color |

### Typography Classes

| Class | Effect |
|-------|--------|
| `.title-1` | Largest title (display headings) |
| `.title-2` | Large title |
| `.title-3` | Medium title |
| `.title-4` | Small title |
| `.heading` | Standard UI heading (default size) |
| `.body` | Increased line height (readable text) |
| `.document` | Document font + line height (long content) |
| `.caption` | Smaller sub-text |
| `.caption-heading` | Small heading |
| `.monospace` | Monospace font |
| `.numeric` | Tabular figures (aligned numbers) |
| `.dimmed` | Partial transparency |
| `.dim-label` | Same as `.dimmed` (deprecated alias) |

### OSD / Overlay

| Class | Effect |
|-------|--------|
| `.osd` | Dark semi-transparent background (buttons, toolbars, progress bars, overlays) |
| `.selection-mode` | Large round check buttons |

### Image

| Class | Effect |
|-------|--------|
| `.icon-dropshadow` | Drop shadow for app icons |
| `.lowres-icon` | Drop shadow for ≤32×32 icons |

### Scrolled Window

| Class | Effect |
|-------|--------|
| `.undershoot-top` | Shadow indicator at top |
| `.undershoot-bottom` | Shadow indicator at bottom |
| `.undershoot-start` | Shadow indicator at start (follows text direction) |
| `.undershoot-end` | Shadow indicator at end (follows text direction) |

### Property Rows

| Class | Effect |
|-------|--------|
| `.property` | De-emphasizes title, emphasizes subtitle (for `AdwActionRow` / `AdwExpanderRow`) |

---

## Widget Properties for Layout

GTK4 widgets provide properties that replace the need for custom CSS
spacing:

| Property | Type | Purpose |
|----------|------|---------|
| `marginTop` | `number` | Top margin |
| `marginBottom` | `number` | Bottom margin |
| `marginStart` | `number` | Start margin (follows text direction) |
| `marginEnd` | `number` | End margin (follows text direction) |
| `halign` | `Gtk.Align` | Horizontal alignment |
| `valign` | `Gtk.Align` | Vertical alignment |
| `hexpand` | `boolean` | Expand horizontally |
| `vexpand` | `boolean` | Expand vertically |
| `spacing` | `number` | Child spacing (`GtkBox`) |
| `hscrollbarPolicy` | `Gtk.PolicyType` | Horizontal scroll policy |
| `vscrollbarPolicy` | `Gtk.PolicyType` | Vertical scroll policy |

**Use these instead of CSS `margin-*` / `padding-*` whenever possible.**

---

## Helper Patterns

### Activatable Cards

Add both `.card` and `.activatable` to get hover/active states:

```tsx
<Gtk.Box cssClasses={['card', 'activatable']}>
    {/* content */}
</Gtk.Box>
```

`GtkButton` with `.card` gets this automatically.

### Validation States

Use `.error`, `.success`, or `.warning` on `GtkEntry` to indicate
input validation.

### Custom CSS

When you need custom CSS (e.g. backdrop-filter, animations), use
native variables so it adapts to theme changes:

```css
/* Good */
.my-widget {
    background-color: color-mix(in srgb, var(--card-bg-color) 55%, transparent);
    border-radius: var(--window-radius);
}

/* Bad — won't adapt to theme */
.my-widget {
    background-color: #313244;
    border-radius: 8px;
}
```

### Deprecation Notes

| Deprecated | Use Instead |
|------------|-------------|
| `.content` | `.boxed-list` |
| `.sidebar` | `.navigation-sidebar` + `GtkSeparator` |
| `.app-notification` | `AdwToastOverlay` |
| `.large-title` | `.title-1` |
| `.opaque` | `.suggested-action` with accent override |
| `.dim-label` | `.dimmed` |
| `@theme_bg_color`, `@accent_bg_color`, etc. | `--window-bg-color`, `--accent-bg-color` |
