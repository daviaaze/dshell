# Upstream PR Plan — `origin/main` → `upstream/main`

> Branch: `main` (origin) | HEAD: `7985d99` | Merge base: `794025f`
> **114 commits ahead**, **152 files**, +18,951 / -2,602 lines

---

## Recent Additions (since last plan)

4 NM SEGV fixes added on `main` after `gnim-v2-migration`:

| Commit | What |
|--------|------|
| `5f7f041` | fix: restore bluetoothAudio wrapper, replace unreachable NM GIR flags |
| `f125f69` | fix: defer network wifi binding to avoid SEGV during mount |
| `b78c4a4` | fix: defensive NM type handling in settings network and toArray |
| `7985d99` | fix: remove AP enumeration to prevent NM assertion SEGV |

---

## Build Status

**`nix build` fails**: `@gnim-js/gtk4@2.0.0-beta.0` not in pnpm store.

```bash
# Fix: update pnpmDeps hash in nix/desktop-shell.nix
# 1. Set pnpmDeps.hash = ""
# 2. nix build (will fail with hash mismatch)
# 3. Copy the 'got: sha256-...' value back
```

---

## PR Grouping (consolidated from previous plan)

| # | PR | Files | Dependencies |
|---|----|-------|-------------|
| 1 | **Foundation**: logger, gschema, settings, shellState, windowManager, monitors, gjsUtils, common components, CSS utils, Nix/build/deps | ~30 | None |
| 2 | **Bar + Indicators**: clock, workspaces, systemUsage, windowTitle, weather, 10 indicators, launcher | ~15 | #1 |
| 3 | **Connectivity**: appMixer, audioAutoSwitch, bluetoothBattery, network overhaul, NM SEGV fixes | ~18 | #1 |
| 4 | **Quick Settings**: button grid (8 toggles), sliders, audioEndpointControl, expanders, notificationList, tray, powerMenu | ~25 | #1, #3 |
| 5 | **Settings Panel**: bar, clock, general, network, weather pages | ~8 | #1 |
| 6 | **New Widgets**: dock, windowSwitcher, lockscreen | ~5 | #1 |
| 7 | **System Features**: hypridle, nightLight, updates, touchpad, keyboard, fingerprint, keepAwake, powerProfiles | ~12 | #1, #4 |
| 8 | **Clipboard + Recording + Screenshot** | ~6 | #1 |
| 9 | **Theme & Design**: material-you, design tokens, colorScheme, bar visibility | ~8 | #1 |
| 10 | **Tests + CI + Docs** | ~25 | All |

---

## Files to Exclude

| File | Reason |
|------|--------|
| `PI_CONTEXT.md` | Session scratchpad |
| `COMPONENTIZATION_PROMPT.md` | AI prompt artifact |
| `SKILL.md` | AI tool config |
| `ARCHITECTURE_ACTION_PLAN.md` | AI planning doc |
| `Knowledge-Base/` | AI knowledge base |
| `.vscode/settings.json` | Editor config |

---

## Commits to Exclude

| Commit | Hash | Reason |
|--------|------|--------|
| `feat: add auto-cpufreq...` | `a035c6d` | Added then removed |
| `fix(auto-cpufreq): ...` | `4120397` | Fix for removed feature |
| `remove auto-cpufreq support` | `00dcd8d` | Net-zero removal |
