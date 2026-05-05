# PI Session Context

> **Ephemeral scratchpad.** This file is task-specific and may be regenerated or
> cleared between sessions. Do not put permanent project rules here — use
> `AGENTS.md` for invariants.

---

## Current Task

**Stabilize all pending changes** — ensure the repo builds, dead code is removed,
and all modifications are coherent before committing.

---

## Active Files

- `data/scripts/shade-toggle.sh` — converted from shell to GJS; fixed `System.exit` → `exit` from `"system"`
- `meson.build` — uses `configure_file` for shade-toggle.sh with `@gjs@` substitution
- `flake.nix` — added `uwsm` and `pipewire` to dev shell
- `src/widget/osd/index.tsx` — combined duplicate Popup entries (volume/mute) into single `signals` array
- `src/widget/osd/popup.tsx` — changed `signal: string` → `signals: string[]`, loops over connections
- `src/widget/quicksettings/button-grid/index.tsx` — removed Touchpad button import and usage
- `src/lib/touchpad.ts` — **DELETED** (orphaned after QS removal)
- `src/widget/quicksettings/button-grid/touchpad.tsx` — **DELETED** (orphaned after QS removal)
- `data/scripts/toggle-touchpad.py` — **DELETED** (removed from `meson.build` and NixOS keybindings; no longer needed)
- `AGENTS.md` — rewritten for high-signal / low-overhead agent context

---

## Related Schemas / State / Bindings

- No schema changes involved.
- OSD popups now use `signals: string[]` prop — verify no other callers use old `signal` prop.
- `shade-toggle.sh` is consumed by `src/lib/keybinds.ts` (`${BINDIR}/shade-toggle.sh`).

## Widget Mount Order Impact

Mount order: `Wallpaper → bar → osd → applauncher → notifications → quicksettings → LockScreen → settings`

**OSD changes** are in `osd()` — low risk, early in mount order but already working.
**QS changes** are in `quicksettings()` — removing Touchpad button is safe.

---

## Issues Found & Fixed During Stabilization

| Issue | Fix |
|-------|-----|
| `shade-toggle.sh` used `System.exit(1)` which doesn't exist in GJS ES modules | Changed to `import { exit } from "system"` and `exit(1)` |
| `toggle-touchpad.py` still referenced in `meson.build` and NixOS keybindings | Removed all references and deleted the file; hardware touchpad keybinds removed from Hyprland config |
| `src/lib/touchpad.ts` and `touchpad.tsx` orphaned after QS removal | Deleted dead code files |

---

## Build Status

✅ `nix build` **passes** (verified on current tree).

---

## Temporary Notes / Hypotheses

- Touchpad hardware keybinds (`nix/hyprland/binds.nix`) removed entirely — no touchpad toggle in QS or Hyprland binds.
- `shade-toggle.sh` GJS rewrite should be slightly faster than shell + gdbus (no process spawning), but the main win is removing the gdbus path search loop.

---

## Verification Checklist

- [x] `nix build` succeeds
- [x] No synchronous `Notifd.get_default()` introduced
- [x] No `GLib.List` passed directly to `<For>`
- [x] `GObject.notify()` uses kebab-case if applicable
- [x] No `.catch(() => {})` added
- [ ] CHANGELOG.md updated if user-visible behavior changed (deferred to user)
- [ ] Version bumped if needed (not required for stabilization)
