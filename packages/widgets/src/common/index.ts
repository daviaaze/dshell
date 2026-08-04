/**
 * Shade Shell Design System — Reusable UI Components
 *
 * This directory contains shared, reusable components used across
 * all shell widgets (bar, dock, quicksettings, settings, etc.).
 *
 * ## Component Catalog
 *
 * ### Buttons
 * | Component | File | Description |
 * |-----------|------|-------------|
 * | `QuickToggleButton` | `quickToggleButton.tsx` | Toggle button with icon, label, and optional popover. Used in QS button grid. |
 * | `IconButton` | `iconButton.tsx` | Button with icon, optional label, active state. |
 * | `IconMenuButton` | `iconButton.tsx` | Button with icon + dropdown arrow for menus. |
 * | `ActionButton` | `actionButton.tsx` | Destructive/colored action button. |
 *
 * ### Layout
 * | Component | File | Description |
 * |-----------|------|-------------|
 * | `LinkedBox` | `linkedBox.tsx` | Container that links child widgets visually (no spacing between). |
 * | `IconInfoRow` | `iconInfoRow.tsx` | Row with icon, label, and optional secondary text. |
 *
 * ### Controls
 * | Component | File | Description |
 * |-----------|------|-------------|
 * | `Slider` | `slider.tsx` | Labeled slider with icon, used for volume/brightness. |
 * | `AudioEndpointControl` | `audioControl.tsx` | Audio device selector with volume slider. |
 *
 * ### Content
 * | Component | File | Description |
 * |-----------|------|-------------|
 * | `Notification` | `notification.tsx` | Toast notification widget with image, actions, auto-dismiss. |
 * | `PowerMenu` | `powerMenu.tsx` | Power actions (lock, suspend, restart, shutdown). |
 * | `WeatherIcon` | `weatherWidget.tsx` | Weather condition icon. |
 * | `WeatherWidget` | `weatherWidget.tsx` | Full weather widget with current conditions, sun/moon info, forecast, details. |
 *
 * ### Utilities
 * | Utility | File | Description |
 * |---------|------|-------------|
 * | `usePopoverCleanup` | `popoverCleanup.ts` | Popover lifecycle hook that cleans up on unmount. |
 * | `getVolumeIcon` | `audioControl.tsx` | Returns icon name for a given volume level. |
 *
 * ## Usage
 *
 * ```tsx
 * import { QuickToggleButton } from "./quickToggleButton"
 * import { Slider } from "./slider"
 * import { IconButton } from "./iconButton"
 * ```
 *
 * ## Adding Components
 *
 * 1. Create `YourComponent.tsx` in this directory
 * 2. Export a named function component that returns a Gtk.Widget
 * 3. Accept typed props (define an interface)
 * 4. Add to the catalog above
 * 5. Use `cssClasses={["descriptive-class"]}` for styling
 *
 * ## Design Principles
 *
 * - **Single responsibility**: Each component handles one UI concern
 * - **No singleton access**: Components receive data via props, not `get_default()`
 * - **Libadwaita classes preferred**: Use `card`, `frame`, `linked`, `circular`, `flat`, `raised` etc.
 * - **Reactive ready**: Accept `Accessor<T>` for any prop that should be reactive
 */

export {ActionButton} from './actionButton';
export {AudioEndpointControl, getVolumeIcon} from './audioControl';
export {IconButton, IconMenuButton} from './iconButton';
export {IconInfoRow} from './iconInfoRow';
export {LinkedBox} from './linkedBox';
export {default as Notification} from './notification';
export {usePopoverCleanup} from './popoverCleanup';
export {PowerMenu} from './powerMenu';
// Re-export all components for convenience
export {QuickToggleButton} from './quickToggleButton';
export {Slider} from './slider';
export {WeatherIcon, WeatherWidget} from './weatherWidget';
