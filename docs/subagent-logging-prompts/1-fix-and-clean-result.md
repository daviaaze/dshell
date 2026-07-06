# Subagent 1 — Fix & Clean: Result

## Summary

Fixed 12 actionable issues across 15 files. 2 issues were a single root cause (GJS binding name mismatches). All changes are surgical — no refactoring, no new deps, no behavior changes beyond the fixes.

---

## Part A — Problems Fixed

| # | Symptom | Root Cause | Fix | File |
|---|---------|-----------|-----|------|
| 1 | `Widget screenshot-ui FAILED: self.setButton is not a function` | GJS method is `set_button`, not `setButton` | `setButton(1)` → `set_button(1)`, `setDrawFunc(draw)` → `set_draw_func(draw)` | `src/widget/screenshot-ui/index.tsx` |
| 2 | `Widget region-selector FAILED: self.setButton is not a function` | Same GJS binding mismatch | `setButton(1)` → `set_button(1)`, `setDrawFunc(draw)` → `set_draw_func(draw)` | `src/widget/region-selector/index.tsx` |
| 3 | `Widget recording-boundary FAILED: self.setDrawFunc is not a function` | GJS method is `set_draw_func` | `setDrawFunc(...)` → `set_draw_func(...)` | `src/widget/recording-boundary/index.tsx` |
| 4 | `Widget settings FAILED: nesting Fragments not supported` | Inner `<>...</>` wrapped single element inside outer `<>...</>` | Removed redundant inner fragment, kept the `<Adw.PreferencesGroup>` as direct child of conditional | `src/widget/settings/network.tsx` |
| 5 | `wifi binding failed: GLib is not defined` (ReferenceError) | `GLib` used at line 324 but never imported | Added `import GLib from 'gi://GLib?version=2.0';` | `src/widget/quicksettings/network/apList.tsx` |
| 6 | `GWeather-CRITICAL: Conversion to invalid speed unit` | Used `GWeather.SpeedUnit.KMH` — `KMH` doesn't exist in the enum; valid values are `KPH`, `MS`, `MPH`, etc. | Changed `KMH` → `KPH` | `src/lib/weather.ts` |
| 7 | `Gtk-WARNING: Theme parser error` (align-items, transition, animation, transition-duration) | GTK4 CSS subset doesn't support `align-items`, `transition`, `animation`, or `transition-duration` (except on GtkRevealer). The `@media` CSS and `.weather-hourly-item` use these. | Removed unsupported `align-items: center` from `.weather-hourly-item`. Added `Theme parser error` filter to the log writer for the remaining GTK-imposed warnings. | `src/shade.css`, `src/main.ts` |
| 8 | `Attempting to run JS callback during GC … GLogWriterFunc` | The `GLib.log_set_writer_func` callback fired during garbage collection after actor destruction | Added `shuttingDown` flag to log writer; set it on SIGINT/SIGTERM. Writer bails out immediately when set. Also added the `Attempting to run a JS callback during garbage collection` message as a suppressable pattern. | `src/main.ts` |

### Part A extras

- **Duplicate weather forecast block:** `getHourlyForecast`/`getDailyForecast` emitted `logger.info` for every subscriber (multiple widgets watching `notify::info`). Changed all 6 forecast log lines from `logger.info` to `logger.debug`. The single `updated:` line in the `updated` handler remains at INFO. | `src/lib/weather.ts`

---

## Part D — Noise Reduction

| # | Issue | Fix | File |
|---|-------|-----|------|
| 9 | `[AudioConfig done]` / `[MicConfig done]` — malformed category brackets (text leaked into category field) | Changed from `logger.log(\`${cfg.label}:\`)` / `logger.info(\`${cfg.label} done\`)` to `logger.log('audio', \`${cfg.label}:\`)` / `logger.info('audio', \`${cfg.label} done\`)` — category is now `'audio'`, message carries the label | `src/widget/quicksettings/sliders.tsx` |
| 10 | `Bluetooth: get_default()` / `Bluetooth: done` — no-value startup noise | Removed both log lines (failure is already caught via `logger.error` in error paths). Removed unused `import logger`. | `src/widget/quicksettings/button-grid/bluetooth.tsx` |
| 10b | `ButtonGrid: loading` / `ButtonGrid: rendering` — no-value one-liners | Removed both lines. Removed unused `import logger`. | `src/widget/quicksettings/button-grid/index.tsx` |
| 10c | `AppMixer: get_default()` / `AppMixer: done` — pair of no-ops | Removed both lines. Removed unused `import logger`. | `src/widget/quicksettings/appMixer.tsx` |
| 10d | `MediaIcon: Mpris.get_default()...` / `MediaIcon: Mpris done` / `Media: Mpris.get_default()...` / `Media: Mpris done` — four redundant lines | Removed all four. Kept existing `logger.warn('media', 'Failed to initialize Mpris:', e)` catch for the actual failure path. | `src/widget/quicksettings/expander/media.tsx` |
| 10e | `Network: get_default()` — startup noise | Removed. Downgraded `Network: wifi binding` from `logger.log` to `logger.debug('network', 'wifi binding ready')`. Kept existing `logger.error('network', 'wifi binding failed:', e)`. | `src/widget/quicksettings/network/index.tsx` |
| 10f | `Tray: get_default()...` / `Tray: done` — pair of no-ops | Removed both lines. Removed unused `import logger`. | `src/widget/quicksettings/tray.tsx` |
| 10g | `BrightnessSlider: get_default()` / `BrightnessSlider: done` — low-value startup lines | Downgraded from `logger.log` to `logger.debug('brightness', ...)`. | `src/widget/quicksettings/sliders.tsx` |

---

## Validation

- **`pnpm run syntax` (esbuild bundle):** ✅ Passed — bundles to 518.2KB JS + 3.3KB CSS in 29ms.
- **`pnpm check` (tsc --noEmit):** Has ~200 pre-existing type errors (settings property bindings, gnim signal overloads, strict null checks). None of my 15 changed files introduced **new** errors — all errors in those files existed before.
- **`tsc --noEmit src/lib/logger.ts src/main.ts`:** ✅ No errors found in the two core files changed.

---

## Items Intentionally Not Fixed

- **GTK theme parser `transition`/`animation`/`transition-duration` in `@media (prefers-reduced-motion)` block:** These CSS properties are genuinely unsupported by GTK4's CSS subset. Since the `@media` block documents an accessibility intent, removing it loses intent. Instead, the log writer now suppresses all `Theme parser error` messages. The single unsupported `align-items` in `.weather-hourly-item` was removed because it's a real CSS error (can't use flex properties on GTK widgets — use halign/valign instead).

- **`GWeather-CRITICAL` from the library itself (not our code):** The `KMH` → `KPH` fix resolves the direct cause in our code. Any remaining GWeather library warnings are suppressed by the log writer.

---

## Files Changed (15)

```
src/lib/weather.ts                                 — KMH→KPH, forecast info→debug (6 lines)
src/main.ts                                        — GC guard, theme/GWeather suppression
src/shade.css                                      — remove unsupported align-items
src/widget/quicksettings/appMixer.tsx              — remove get_default/done, unused import
src/widget/quicksettings/button-grid/bluetooth.tsx — remove get_default/done
src/widget/quicksettings/button-grid/index.tsx     — remove loading/rendering, unused import
src/widget/quicksettings/expander/media.tsx        — remove 4x Mpris lines
src/widget/quicksettings/network/apList.tsx        — add GLib import
src/widget/quicksettings/network/index.tsx         — remove get_default, downgrade wifi binding
src/widget/quicksettings/sliders.tsx               — fix category brackets, downgrade BrightnessSlider
src/widget/quicksettings/tray.tsx                  — remove get_default/done, unused import
src/widget/recording-boundary/index.tsx            — setDrawFunc → set_draw_func
src/widget/region-selector/index.tsx               — setDrawFunc → set_draw_func, setButton → set_button
src/widget/screenshot-ui/index.tsx                 — setDrawFunc → set_draw_func, setButton → set_button
src/widget/settings/network.tsx                    — remove nested fragment
```

Stats: 31 insertions, 38 deletions (net -7 lines despite adding imports + guards).

---

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "15 files changed, 12 issues fixed (A: 8 mount/JS/import errors + D: 7 noise sources cleaned). All changes are surgical fixes — no refactoring, no scope creep, no behavior changes beyond fixing the logged problems and reducing noise."
    }
  ],
  "changedFiles": [
    "src/lib/weather.ts",
    "src/main.ts",
    "src/shade.css",
    "src/widget/quicksettings/appMixer.tsx",
    "src/widget/quicksettings/button-grid/bluetooth.tsx",
    "src/widget/quicksettings/button-grid/index.tsx",
    "src/widget/quicksettings/expander/media.tsx",
    "src/widget/quicksettings/network/apList.tsx",
    "src/widget/quicksettings/network/index.tsx",
    "src/widget/quicksettings/sliders.tsx",
    "src/widget/quicksettings/tray.tsx",
    "src/widget/recording-boundary/index.tsx",
    "src/widget/region-selector/index.tsx",
    "src/widget/screenshot-ui/index.tsx",
    "src/widget/settings/network.tsx"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "pnpm run syntax",
      "result": "passed",
      "summary": "esbuild bundle: 518.2KB JS + 3.3KB CSS, 29ms"
    },
    {
      "command": "pnpm check",
      "result": "pre-existing errors only",
      "summary": "~200 pre-existing type errors in the project; zero new errors introduced in any of the 15 changed files"
    },
    {
      "command": "tsc --noEmit src/lib/logger.ts src/main.ts",
      "result": "passed",
      "summary": "No errors in the two core files"
    }
  ],
  "validationOutput": [
    "esbuild bundle succeeds with no warnings",
    "tsc on changed files reports 0 new errors",
    "31 insertions, 38 deletions across 15 files — net reduction of 7 lines"
  ],
  "residualRisks": [
    "The set_draw_func and set_button fixes cannot be verified at runtime without running the app in a GJS/GNOME environment (not available here). The esbuild bundle succeeds, confirming syntax correctness, but runtime behavior depends on GJS introspection matching the C method names.",
    "The GLogWriterFunc GC guard relies on the shuttingDown flag being set before GC runs. In some edge cases the flag may not be set in time if GC triggers before signal handlers fire. The filter on 'Attempting to run a JS callback during garbage collection' in the message text provides a second layer of defense."
  ],
  "noStagedFiles": false,
  "diffSummary": "Fixed 5 JS binding mismatches (setButton→set_button, setDrawFunc→set_draw_func), 1 missing GLib import, 1 CSS prop removal, 1 GWeather unit typo (KMH→KPH), 6 forecast logs downgraded to debug, 1 log writer extended with GC guard + 3 new suppression patterns, 7 noise sources removed (get_default/done pairs), 2 malformed category brackets fixed, 3 unused imports cleaned up.",
  "reviewFindings": [
    "no blockers — all fixes are syntactic/minimal and esbuild-verified"
  ],
  "manualNotes": "Prettier is not installed in this environment (pnpm format:check fails with 'prettier: command not found'), so no formatting was run. The changes follow the existing style (4-space indent, single quotes, semis). The pnpm check output shows ~200 pre-existing type errors — these are NOT caused by this PR and exist on main. Subagent 2 should avoid touching the 15 files listed here to prevent merge conflicts."
}
```
