# Spec: AppLauncher

> Application launcher with frecency-boosted search and clipboard history.

## Overview

- **Source**: `src/widget/applauncher/` (entry: `index.tsx`)
- **Dependencies**: `AstalApps`, `Astal`, `ShellState`, `WindowManager`, `FrecencyManager`
- **Type**: `Astal.Window`, floating above the bar, keymode `ON_DEMAND`, visible when `ShellState.launcherOpen`

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Closed | Default | Window is hidden; `ShellState.launcherOpen` is false |
| F2 | Apps mode | Open via launcher button or shortcut | Entry search field focused; shows frecency-ranked app list; query field empty |
| F3 | Clipboard mode | Type `>` in search field | Mode switches to clipboard; subsequent text queries clipboard history |
| F4 | Searching apps | Type in entry | Results filtered by `fuzzyQuery`; re-ranked by frecency boost |
| F5 | Searching clipboard | Type after `>` prefix | Results filtered by `searchClipboard`; shows history items |
| F6 | Empty results | No matches | `Adw.StatusPage` shown with contextual icon and message (Portuguese) |
| F7 | Side bar position | Bar position LEFT or RIGHT | Closes QuickSettings if open (they share the same edge) |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Click app result | App launches via `uwsm-app -t service -- <entry>`; frecency recorded; launcher closes |
| I2 | Press Enter on search | First search result launched (apps mode only) |
| I3 | Click clipboard result | `copyClipboardItem(item)` called; launcher closes |
| I4 | Press Escape | Launcher closes |
| I5 | Click outside window | Closes (window loses visibility) |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | No apps installed/found | StatusPage with "Nenhum aplicativo encontrado" |
| E2 | No clipboard history | StatusPage with "Nenhum resultado no histórico" |
| E3 | Frecency unavailable (`fm.hasData` false) | Shows default "Most used apps" label; app list unsorted |
| E4 | Query restored from ShellState.launcherQuery | Entry pre-filled with previous query on re-open |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Window | `card` + `frame` + `background` | Adw classes, no custom colors |
| Body | `applauncher-body` | Spacing only (8px) |
| Entry placeholder text | `--shade-fg-dim` | Applied via theme defaults |
| Search hints | `caption` | Adw style class |
| App result buttons | `app-button` + `useStyle` (hover/active `--shade-*` bg) | Hover/active use theme variables with fallback |
| Status page | `Adw.StatusPage` | Standard Adw component |
| Entry margins | Inline `css` (`padding-right:0px; margin-right:4px`) | Layout-only — compliance linter exception? Layout only |

### Adwaita checklist

- [ ] App buttons use Adw `title-2` and `body` label classes
- [ ] Icon sizes 48px (app) / 32px (clipboard) per mockup
- [ ] Status page uses symbolic icons
- [ ] Verified in light and dark variants

## Test plan

- **Unit**: extract and test `fuzzyQuery` search, `FrecencyManager` rank/frecency logic, `searchClipboard` filtering
- **Compliance linter**: violations for inline `css` with padding/margin properties — these are layout-only
- **Visual/manual**: screenshots with results + empty state in both modes
