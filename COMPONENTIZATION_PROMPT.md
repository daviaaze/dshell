# Shade Shell Componentization & Styling Audit

## Context
You are auditing the **shade-shell** codebase — a Hyprland desktop shell written in TypeScript/GJS with GTK4/Libadwaita via Gnim (React-like JSX framework). The goal is to identify repetition, inconsistencies, and opportunities to extract reusable components, hooks, and styling patterns.

## Current Pain Points (from recent fixes)
- **ButtonGrid**: 10 separate files all using identical `Adw.SplitButton` patterns with `hexpand`, `cssClasses={["raised"]}`, popover cleanup, and `Adw.ButtonContent` children
- **Expander icons**: 4 icon components (`BatteryIcon`, `CalendarIcon`, `WeatherIcon`, `MediaIcon`) with nearly identical layout structure (`Gtk.Box` → `Gtk.Image` + `Gtk.Box` vertical labels) but duplicated across files
- **Tray buttons**: Multiple circular icon buttons with identical patterns but no shared `IconButton` component
- **Padding/margins**: Inconsistent application of spacing — some via CSS classes, some via inline `margin*` props, some via `css="..."` strings
- **Popover cleanup**: Every `Adw.SplitButton` duplicates the same `destroy` handler to unparent its popover
- **Slider components**: `AudioEndpointControl` and `Slider` share volume logic but live in different directories

## Audit Checklist

### 1. Component Extraction Opportunities
Search for repeated JSX patterns across `src/widget/` and `src/lib/`:

- [ ] **SplitButton wrapper**: All quick-settings toggle buttons (`powerprofiles.tsx`, `colorScheme.tsx`, `bluetooth.tsx`, `network/index.tsx`, `screenshot.tsx`, `caffeinated.tsx`, `touchpad.tsx`, `nightLight.tsx`, `idleControls.tsx`) share:
  - `Adw.SplitButton` with `hexpand` and `cssClasses`
  - Popover `destroy` cleanup handler
  - `Adw.ButtonContent` child with `iconName` + `label` bindings
  - Popover containing `Gtk.Box cssClasses={["linked"]} orientation={VERTICAL}`
  
  **→ Extract**: `QuickToggleButton` component accepting `icon`, `label`, `popover`, `onClick`, `cssClasses` props

- [ ] **IconInfo row**: `BatteryIcon`, `CalendarIcon`, `WeatherIcon`, `MediaIcon` all use:
  ```
  Gtk.Box (horizontal, centered)
    → Gtk.Image (pixelSize=20, iconName binding)
    → Gtk.Box (vertical)
        → Gtk.Label (primary text)
        → Gtk.Label (secondary text)
  ```
  
  **→ Extract**: `IconInfoRow` component with `icon`, `primary`, `secondary`, `visible` props

- [ ] **Circular icon buttons**: `TrayBox` has `LockButton`, `RotateButton`, `SettingsButton` all using `Gtk.Button cssClasses={["circular"]} → Gtk.Image`. `PowerButton` is almost identical but with `Gtk.MenuButton`.
  
  **→ Extract**: `IconButton` / `IconMenuButton` components

- [ ] **Card wrapper**: `Battery`, `Weather`, `AppMixer`, `NotificationList` all use `Gtk.Box cssClasses={["card"]} orientation={VERTICAL}` with varying spacing
  
  **→ Extract**: `Card` component with `title`, `spacing`, `padding` props

### 2. Styling System Audit
Review `src/shade.css`, inline `css="..."` props, and `cssClasses` usage:

- [ ] **CSS-in-JS vs CSS classes**: Count how many widgets use inline `css="padding: ..."` vs `margin*` props vs CSS classes. Identify which should be standardized.
- [ ] **Spacing scale**: Is there a consistent spacing system? (4px, 8px, 12px, 16px — seems ad-hoc)
- [ ] **Missing utility classes**: Could common patterns like `padding: 12px` or `gap: 8px` be CSS classes instead of inline props?
- [ ] **Dark mode / transparency**: `.background` and `.card` classes in `shade.css` — are these applied consistently?

### 3. Hook / Utility Extraction
Check `src/lib/` and `src/widget/common/` for shared logic:

- [ ] **Popover cleanup**: The `destroy` → `popover.unparent()` pattern is repeated in every SplitButton
  
  **→ Extract**: `usePopoverCleanup(splitButton)` hook or wrap SplitButton creation

- [ ] **Binding patterns**: `createBinding(obj, "prop")` with `.as(transform)` is everywhere. Are there common transforms (e.g., boolean→visibility, percentage formatting)?

- [ ] **Time formatting**: `fmtDuration` and `fmtDurationHMS` in `battery.tsx` — are there other time displays?

- [ ] **Volume icon logic**: `getVolumeIcon` in `audioControl.tsx` — is this reused everywhere it should be?

### 4. Directory Structure Review
Current structure:
```
src/widget/quicksettings/button-grid/   ← 9 individual button files
src/widget/quicksettings/expander/      ← 5 expander files  
src/widget/common/                      ← only 3 shared components
```

- [ ] Should `button-grid/` buttons be co-located with their lib counterparts? (e.g., `bluetooth.tsx` button next to `lib/bluetooth.ts`)
- [ ] Should there be a `src/widget/components/` directory for truly generic UI primitives?
- [ ] Are `src/widget/common/` and `src/lib/` boundaries clear? (common = UI primitives, lib = business logic/services)

### 5. Specific Files to Review
Read and analyze these for repetition:

| File | What to look for |
|------|-----------------|
| `src/widget/quicksettings/button-grid/*.tsx` | Identical SplitButton patterns |
| `src/widget/quicksettings/expander/*Icon.tsx` | Identical icon+label row layouts |
| `src/widget/quicksettings/tray.tsx` | Repeated circular button pattern |
| `src/widget/common/slider.tsx` | Could this be more generic? |
| `src/widget/common/audioControl.tsx` | Overlap with slider.tsx |
| `src/widget/common/notification.tsx` | Is this reused in popups AND quicksettings? |
| `src/shade.css` | Are there missing utility classes? |

### 6. Proposed Component API Designs
Draft APIs for extracted components (don't implement, just design):

**QuickToggleButton**:
```tsx
interface QuickToggleButtonProps {
  icon: Accessor<string> | string
  label: Accessor<string> | string
  cssClasses?: Accessor<string[]> | string[]
  onClick?: () => void
  popover?: Gtk.Popover
  hexpand?: boolean
}
```

**IconInfoRow**:
```tsx
interface IconInfoRowProps {
  icon: Accessor<string> | string
  primary: Accessor<string> | string
  secondary?: Accessor<string> | string
  pixelSize?: number
  visible?: Accessor<boolean> | boolean
}
```

**Card**:
```tsx
interface CardProps {
  title?: string
  titleCssClasses?: string[]
  spacing?: number
  padding?: number  // uniform margin
  children: Gtk.Widget
}
```

## Deliverables
1. **Repetition report**: List every duplicated pattern with file locations and line counts
2. **Extraction priority**: Rank by (lines saved × maintenance burden). High-impact, low-risk first.
3. **Component API proposals**: TypeScript interfaces for new shared components
4. **Styling recommendations**: CSS class additions, spacing scale, inline vs class guidelines
5. **Refactoring roadmap**: Order of operations — which extractions are safe now vs need architectural changes

## Constraints
- Gnim uses JSX with GTK4 widgets — components are functions returning JSX elements
- GObject bindings use `createBinding(obj, "kebab-case-prop")` pattern
- Some widgets are conditionally rendered (e.g., `nightLight.available ? <NightLight /> : null`) — extracted components must handle `visible` prop correctly
- Don't break existing `gnim-schemas` settings integration
- Keep the glassmorphic/transparent visual style intact
