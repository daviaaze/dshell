# Subagent 1 — Fix & Clean: Logging Problems (A) + Log Noise (D)

You are working in **shade-shell**, a GNOME desktop shell written in TypeScript running on GJS (GTK4 + Adw + libadwaita), built with esbuild/meson, JSX via `gnim`. Repo root is the current working directory.

## Your mission (two parts)

### Part A — Fix the problems surfacing in the log output
Read the startup log output below and fix every actionable issue at its **source** in `src/`. Do not just suppress warnings — fix the root cause where it's a code bug; only suppress when the warning is genuinely benign and not fixable (e.g. GTK theme parser quirks), and in that case suppress it *narrowly* in `src/lib/logger.ts` / `src/main.ts` where log handling lives.

### Part D — Clear repeated / unvaluable log output
Reduce noise: de-duplicate repeated identical lines, downgrade chatty INFO one-liners that carry no value, fix malformed log lines, and remove logs that are pure busywork. Keep signal, drop noise.

## The logging system you must follow (do not reinvent it)

`src/lib/logger.ts` exposes:

- `logger.<debug|log|info|warn|error>(category: string, message: string, ...args)` — always pass a **category** first (e.g. `'mount'`, `'audio'`, `'weather'`, `'network'`, `'geo'`, `'fingerprint'`, `'hw'`, `'app'`, `'perf'`, `'clipboard'`, `'gir'`, `'general'`).
- `perf.start(label, category?)` / `perf.stop(label, category?)` — timing blocks; output is `⏱ label = X.XXms`. Use the `mount` category for widget/service mount timing.
- `safeTry(category, fn)` — run a fn, capture exceptions, log them. Prefer this over try/catch+manual `logger.error` when wrapping mount/factory code.

Conventions already in the codebase:
- Widget mount timing is logged via `perf.start('widget-<name>', 'mount')` … `perf.stop(...)` plus a human line like `logger.log('mount', '<name> mounted in Xms')`.
- Categories are short, lowercase, stable. Reuse existing categories; only add a new one if it's genuinely a new subsystem.

## Concrete issues to fix (from the real startup log)

Work through these. Each item lists the symptom, the file, and the fix direction. Investigate the actual code before changing it — read the file, understand the bug, then make a surgical fix. Match existing style (4-space indent, single quotes, prettier config in `package.json`).

1. **`Widget screenshot-ui FAILED to mount: self.setButton is not a function`** → `src/widget/screenshot-ui/index.tsx`. A method is being called on a `self` that lacks it (likely wrong binding / missing `@register` / method renamed). Fix the binding or the call.

2. **`Widget region-selector FAILED to mount: self.setButton is not a function`** → `src/widget/region-selector/index.tsx`. Same class of bug as #1; fix at source.

3. **`Widget recording-boundary FAILED to mount: self.setDrawFunc is not a function`** → `src/widget/recording-boundary/index.tsx`. `setDrawFunc` is a GTK4 `GtkWidget` method — calling it on something that isn't a `Gtk.Widget` (or before construction). Fix the call site.

4. **`Widget settings FAILED to mount: nesting Fragments are not yet supported`** → `src/widget/settings/network.tsx` (function `network_default3`). A gnim JSX Fragment is nested inside another Fragment. Flatten to a single fragment / array of nodes.

5. **`wifi binding failed: GLib is not defined`** (ReferenceError) → `src/widget/quicksettings/network/apList.tsx:324` (`ApRow`). `GLib` is used but not imported at the top of the file. Add `import GLib from 'gi://GLib?version=2.0';` (check how other files import it — the `?version=2.0` form is used elsewhere).

6. **`GWeather-CRITICAL: Conversion to invalid speed unit`** (repeated) → `src/lib/weather.ts`. A wind-speed value/unit combination is being converted where the unit is invalid for that value. Guard the conversion: validate the unit enum is valid for the value before converting, or skip/skip-and-log-once. **(Part D):** the same `getHourlyForecast` / `getDailyForecast` block logs *two* identical consecutive sets of lines on startup — de-duplicate so the forecast logging fires once per actual refresh, not twice.

7. **`Attempting to run a JS callback during garbage collection … GLogWriterFunc`** → `src/lib/logger.ts` / `src/main.ts`. The custom `GLib.log_set_writer_func` callback is being invoked during GC after actor destruction. Guard the writer function: bail out early (return `HANDLED`) when the app/domain is shutting down, or when the JS context is in an unsafe state. Avoid touching destroyed actors in the writer.

8. **GTK theme parser warnings** (`align-items` on a non-box; `transition`/`animation`/`transition-duration` "junk at end of value") → `src/shade.css` lines ~284, 325, 326, 331. Fix the CSS: `align-items` only applies to boxes; `transition`/`animation` shorthand values had trailing junk. If a line is genuinely valid-but-unsupported by GTK's parser, leave the CSS and narrow-suppress only that `Gtk-WARNING … Theme parser error` domain in the log writer — but **prefer fixing the CSS**.

9. **Malformed category brackets** (Part D): lines like `[AudioConfig done]` and `[MicConfig done]` — the `"done"` text has leaked into the **category** argument. Find those call sites in `src/widget/quicksettings/` (around `AudioConfig`/`MicConfig`) and fix so the category stays clean (e.g. `'audio'`) and `done` is part of the message.

10. **Low-value repetitive one-liners** (Part D): during widget mount the button-grid emits pairs like `Bluetooth: get_default()` / `Bluetooth: done`, `Network: get_default()` / `Network: done`, `BrightnessSlider: get_default()` / `BrightnessSlider: done`, `AppMixer: …`, `MicConfig: …`, `Tray: …`, `MediaIcon: …`, `Media: …`. These `get_default()`/`done` pairs carry no value on a normal boot. Remove them, or downgrade to `logger.debug` and collapse the pair into a single line. Keep any that actually surface a failure (an exception is still logged at error).

## Guardrails

- **Surgical changes.** Touch only what each fix requires. Don't refactor adjacent code, rename unrelated symbols, or restyle.
- **No new deps.** No `npm install`. Use existing imports and the existing `logger`/`perf`/`safeTry` API only.
- **Keep behavior.** Do not change widget structure, features, or UI — only fix the mount/JS errors, the log writer safety, and log text.
- **Match style.** 4-space indent, single quotes, no semicolons-free (project uses semis: `true`). Run `pnpm format` on changed files and `pnpm check` (tsc) before finishing. If `pnpm check` is unavailable in your environment, run `pnpm run syntax` (esbuild bundle) as a smoke test.
- **Build/test:** run `pnpm check` and `pnpm run syntax`. Report any remaining errors verbatim. Do not commit or push — leave changes staged for the user to review.

## Deliverables

1. Source fixes for items 1–10 above, each as the smallest correct change.
2. A short summary at the end:
   - For each item: file, what was wrong, one-line fix description.
   - Whether `pnpm check` and `pnpm run syntax` pass.
   - Any item you intentionally did *not* fix and why (e.g. a GTK warning you chose to suppress rather than fix — justify it).
3. Do not mark complete if `pnpm check` fails; keep the task in-progress and report the blocker.

## Reference: the raw startup log you are fixing

```
[Shade] [INFO] [general] 16:52:16.625606 - No display available for monitor tracking, retrying...
[Shade] [INFO] [general] 16:52:16.655340 - main.ts starting
[Shade] [INFO] [general] 16:52:16.659095 - calling app.runAsync
(shade-shell): Gtk-WARNING: Theme parser error: <data>:284:5-16: No property named "align-items"
(shade-shell): Gtk-WARNING: Theme parser error: <data>:325:26-27: Junk at end of value for transition
(shade-shell): Gtk-WARNING: Theme parser error: <data>:326:25-26: Junk at end of value for animation
(shade-shell): Gtk-WARNING: Theme parser error: <data>:331:34-35: Junk at end of value for transition-duration
[Shade] [INFO] [general] 16:52:17.792749 - Bluetooth: get_default()
[Shade] [INFO] [general] 16:52:17.792859 - Bluetooth: done
[Shade] [INFO] [general] 16:52:17.803296 - Network: get_default()
[Shade] [INFO] [general] 16:52:17.824771 - BrightnessSlider: get_default()
[Shade] [INFO] [general] 16:52:17.824969 - BrightnessSlider: done
[Shade] [INFO] [AudioConfig done] 16:52:17.826628 -
[Shade] [INFO] [general] 16:52:17.828814 - AppMixer: get_default()
[Shade] [INFO] [general] 16:52:17.829050 - AppMixer: done
[Shade] [INFO] [MicConfig done] 16:52:17.830413 -
[Shade] [INFO] [general] 16:52:17.831851 - Tray: get_default()...
[Shade] [INFO] [general] 16:52:17.833864 - Tray: done
[Shade] [INFO] [general] 16:52:17.836238 - MediaIcon: Mpris.get_default()...
[Shade] [INFO] [general] 16:52:17.838111 - MediaIcon: Mpris done
[Shade] [INFO] [general] 16:52:17.846751 - Media: Mpris.get_default()...
[Shade] [INFO] [general] 16:52:17.846873 - Media: Mpris done
[Shade] [ERROR] [mount] - Widget screenshot-ui FAILED to mount: self.setButton is not a function
[Shade] [ERROR] [mount] - Widget region-selector FAILED to mount: self.setButton is not a function
[Shade] [ERROR] [mount] - Widget recording-boundary FAILED to mount: self.setDrawFunc is not a function
[Shade] [ERROR] [mount] - Widget settings FAILED to mount: nesting Fragments are not yet supported
[Shade] [ERROR] [network] - wifi binding failed: GLib is not defined   (-> ../src/widget/quicksettings/network/apList.tsx:324:29)
(shade-shell): GWeather-CRITICAL: Conversion to invalid speed unit   (x4)
[Shade] [INFO] [weather] - getHourlyForecast: found 91 forecast entries
[Shade] [INFO] [weather] - getHourlyForecast: 90 future entries, first in 4060s
[Shade] [INFO] [weather] - getDailyForecast: 91 entries, first ts=0
[Shade] [INFO] [weather] - getDailyForecast: grouped into 10 days: ...
[Shade] [INFO] [weather] - getDailyForecast: 9 future days after skipping today
( <-- the entire weather block above repeats a second time, back to back)
(shade-shell): Gjs: Attempting to run a JS callback during garbage collection ... The offending callback was GLogWriterFunc().
```
