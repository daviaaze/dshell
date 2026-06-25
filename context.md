# Single-Letter Variable Audit — 37 Widget Files

## Summary

After exhaustive review of all 37 files, the vast majority of "single-letter" signals from the code graph are **Gnim reactive callback parameters** (`.as((x) => ...)` patterns). These are idiomatic in Gnim's reactive programming model and cannot be renamed without making the code less readable. The graph tool treats anonymous arrow function parameters as "functions" which inflates the dead-code count.

## Actually Improvable Cases (all low-priority)

| File | Variable | Line | Binding | Suggestion |
|------|----------|------|---------|------------|
| `bar/indicators/battery.tsx` | `b` | 16 | `const b = Batery.get_default()` | Use `battery` |
| `bar/indicators/network.tsx` | `w` | 12,29 | `const w = network.wifi` | Already uses `wifi` everywhere else; `w` is a 2-line temp |
| `bar/indicators/power.tsx` | `pp` | 14 | `const pp = PowerProfiles.get_default()` | `pp` is clear enough |
| `quicksettings/appMixer.tsx` | `id` | 32 | `const id = stream.id` | `streamId` would be clearer |
| `quicksettings/appMixer.tsx` | `x` | 123,125 | `.find((x) => x.id === id)` | Callback param; idiomatic |
| `dock/index.tsx` | `df` | 46 | `const df = getDesktopFileForClient(client)` | `desktopFile` would be clearer but used in 5-line scope |
| `quicksettings/network/index.tsx` | `w` | 10,46 | `const w = network.wifi` | `wifi` would be clearer |

## Verdict on Each File

| File | Verdict |
|------|---------|
| `quicksettings/index.tsx` | ✅ Clean — `p` is a callback param |
| `quicksettings/notificationList.tsx` | ✅ Clean — `n`, `h`, `v`, `d` are all callback params |
| `quicksettings/appMixer.tsx` | ⚠️ Minor — `id`, `x` are callback/temp vars |
| `quicksettings/sliders.tsx` | ✅ Clean — `s`, `m` are callback params |
| `quicksettings/network/index.tsx` | ⚠️ Minor — `w` as temp for `network.wifi` |
| `quicksettings/network/apList.tsx` | ✅ Clean — `c`, `e`, `w` are callback/temp params |
| `bar/clock.tsx` | ✅ Clean — `t`, `v` are callback params |
| `bar/weather.tsx` | ✅ Clean — `v`, `w` are callback params |
| `bar/windowTitle.tsx` | ✅ Clean — `c` is a callback param |
| `bar/systemIndicators.tsx` | ✅ Clean — `v` is a callback param |
| `bar/indicators/battery.tsx` | ⚠️ Minor — `b` as temp for `Batery.get_default()` |
| `bar/indicators/bluetooth.tsx` | ✅ Clean — `d` is a callback param |
| `bar/indicators/keyboard.tsx` | ✅ Clean — `l` is a callback param |
| `bar/indicators/network.tsx` | ⚠️ Minor — `w` as temp |
| `bar/indicators/power.tsx` | ✅ Acceptable — `pp` is clear |
| `bar/indicators/audio.tsx` | ✅ Clean — `v` is a callback param |
| `dock/index.tsx` | ⚠️ Minor — `df` for desktopFile |
| `dock/item.tsx` | ✅ Clean — `d` is String filter callback |
| `osd/index.tsx` | ✅ Clean — `m` is monitor callback param |
| `applauncher/index.tsx` | ✅ Clean — `m`, `l`, `p` are callback params |
| `lockscreen/index.tsx` | ✅ Clean — `t`, `s`, `w` are callback params |
| `wallpaper/index.tsx` | ✅ Clean — No single-letter locals |
| `common/audioControl.tsx` | ✅ Clean — `v`, `d`, `t` are callback params |
| `common/slider.tsx` | ✅ Clean — `v` is callback param |
| `common/notification.tsx` | ✅ Clean — `a` is callback param |
| `button-grid/bluetooth.tsx` | ✅ Clean — `addr`, `d` are callback params |
| `button-grid/caffeinated.tsx` | ✅ Clean — No singles |
| `button-grid/colorScheme.tsx` | ✅ Clean — `c` is callback param |
| `button-grid/idleControls.tsx` | ✅ Clean — `t`, `e` are callback params |
| `button-grid/nightLight.tsx` | ✅ Clean — `t`, `e` are callback params |
| `button-grid/powerprofiles.tsx` | ✅ Acceptable — `pp` is clear |
| `button-grid/screenshot.tsx` | ✅ Clean — `rec` is callback param |
| `expander/battery.tsx` | ✅ Clean — `e`, `p`, `r` are callback params |
| `expander/media.tsx` | ✅ Clean — `p`, `s`, `c`, `id`, `path` are callback params |
| `expander/weather.tsx` | ✅ Clean — No singles |
| `expander/worldClock.tsx` | ✅ Clean — `t` is callback param |
| `expander/calendar.tsx` | ✅ Clean — No singles |

## Recommendation

**Skip the single-letter rename pass.** The graph tool's dead-code detector flags Gnim reactive callback parameters as standalone functions, creating 200+ false positives. The actual code quality is good — only 5-6 minor temp variables across 37 files would benefit from one character more of naming. Not worth touching 37 files for.

Instead, focus on the **structural refactors**: splitting complex functions (ApRow CC=41, createLocks CC=26), removing genuinely unused classes (Brightness), and generalizing AudioConfig/MicConfig.
