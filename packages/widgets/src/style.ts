import {registerStyleSheet} from '@shade/style/cssProvider';

/**
 * Widget-level CSS that cannot live on a widget's `css` prop.
 *
 * The `css` prop only applies when its value is a static string at
 * construction (gnim renderer quirk) — reactive `css={accessor}` never
 * renders. Use stylesheet classes for state-dependent styling instead.
 */
registerStyleSheet(`
/* Window switcher: opaque item background, accent when selected */
.switcher-item {
  background-color: @window_bg_color;
  border-radius: var(--window-radius);
}
.switcher-item-selected {
  background-color: var(--accent-bg-color);
  color: var(--accent-fg-color);
  border-radius: var(--window-radius);
}

/* Keep vertical text controls inside the fixed 48px bar viewport. */
button.bar-vertical-content-button,
.bar-vertical-content-button > button {
  padding-left: 0;
  padding-right: 0;
}

/* Bar clusters stay flat: no window shadow behind the transparent bar. */
.bar-window {
  background-color: transparent;
  box-shadow: none;
}

/* Shell cards keep Adwaita's colors and corners but swap the blurred shadow for a
   flat 1px edge, so card boundaries stay visible on light palettes. */
.card,
.boxed-list,
.boxed-list-separate > row {
  box-shadow: 0 0 0 1px var(--border-color);
}

/* Dock running/focused indicator under the app icon. */
.status-running,
.status-active {
  min-width: 6px;
  min-height: 4px;
  border-radius: 2px;
  background-color: alpha(@window_fg_color, 0.5);
}
.status-active {
  min-width: 16px;
  background-color: var(--accent-bg-color);
}

/* Tray icon that asks for attention. */
.needs-attention {
  color: @warning_color;
}

/* Launcher row that Enter will start. */
.app-button-primary {
  background-color: alpha(@accent_bg_color, 0.2);
}

/* Quick-settings tiles: an active toggle uses the accent color so on/off reads at a glance. */
.quick-tile button.toggle:checked {
  background-color: var(--accent-bg-color);
  color: var(--accent-fg-color);
}
.quick-tile button.toggle:checked:hover {
  background-color: color-mix(in srgb, var(--accent-bg-color) 90%, white);
}
.quick-tile button.toggle:checked .dimmed {
  opacity: 0.85;
}
`);
