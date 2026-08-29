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
  border-radius: calc(var(--window-radius) * 1.5);
}
.switcher-item-selected {
  background-color: alpha(@accent_bg_color, 0.85);
  border-radius: calc(var(--window-radius) * 1.5);
}
`);
