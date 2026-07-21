# Stabilization Plan — Greeter Nix Wiring, Clipboard Sync, Capture

**Date:** 2026-07-21
**Status:** Draft
**Scope:** Three independent phases, executed in order. Each phase is self-contained and shippable on its own branch.

---

## Phase 1 — Greeter: fix blockers, then wire into NixOS module

### Findings

The greeter exists but has never been runnable — code blockers plus missing deployment:

**Code blockers (must fix before wiring):**

1. **Username→password transition is dead.** `index.tsx` `handleLogin()` early-returns on `if (!pw) return;` *before* the `!showPassword()` branch — the password entry is always empty on the username step, so F1→F2 (spec `docs/specs/greeter.md`) can never happen. Guard belongs inside the password branch.
2. **No process termination after login.** AstalGreet docs (repo KB: `astal-guide-libraries-greet.md`) explicitly require terminating the greeter process after `start_session_finish`. `GreetSession.startSession()` only logs. The lingering greeter keeps an EXCLUSIVE keygrab on the greetd VT. Fix: `app.quit()` (or `exit(0)`) in the success callback.
3. **Username pre-fill is wrong under greetd.** `GLib.get_user_name()` returns the `greeter` service account the process runs as, not a real user. Default to empty (AccountsService lookup is optional polish).

**Robustness gaps:**

4. `new Greet.Greeter()` / `create_session()` unguarded in `GreetSession.start()` — greetd socket unreachable (spec E1) throws instead of entering the error state.
5. Password entry never `grab_focus()` when revealed.
6. `Adw.Avatar` has no `text` bound → generic placeholder instead of initials.
7. `main.ts` loads no CSS → unthemed (spec tolerates; polish).

**Process gaps:**

8. Spec test plan (GreetSession state machine unit test) never implemented — no greeter test in `package.json` `test`.
9. **Deployment gap:** `nix/module.nix` never configures `services.greetd`. Nothing ever launches the greeter. Plan task 3.4 in `2026-07-12-shell-upgrade-plan.md` completed steps 1–6 but not 7–8.
10. **Deployment gap:** Session command hardcoded to `['Hyprland']` in `src/widget/greeter/index.tsx`.
11. **Follow-up:** nixfiles has no references to this flake at all — consumption side is unwired (out of scope here).

The binary itself builds fine: `nix/desktop-shell.nix` installs `shade-shell-greet` wrapped with `gappsWrapperArgs` (schemas/icons/layer-shell preload handled).

### Design decision

The greeter is a gtk4-layer-shell app and needs a Wayland compositor under greetd. Use **cage** (kiosk compositor, same model as gtkgreet):

- Minimal attack surface, no Hyprland config needed for the login session.
- The existing blur layerrules target the user session, not the greeter — no conflict.

### File map

| File | Change |
|------|--------|
| `nix/module.nix` | Add `programs.shade.greeter.{enable,package,sessionCommand}` options; `services.greetd` config block |
| `flake.nix` | Add `pkgs.cage` to `wrapperPackages` (or reference directly in module) |
| `src/widget/greeter/index.tsx` | Read session command from `SHADE_SESSION_COMMAND` env var, fallback `Hyprland` |
| `docs/specs/greeter.md` | Document the NixOS wiring + env var |

### Tasks

1. **`src/widget/greeter/index.tsx`** — fix `handleLogin` control flow:
   ```ts
   const handleLogin = () => {
       if (greeter.state !== 'idle' && greeter.state !== 'error' && greeter.state !== 'awaiting-input') return;
       if (!showPassword()) {
           if (!username().trim()) return;
           greeter.start(username());
           setShowPassword(true);
           passwordEntry?.grab_focus();
       } else {
           const pw = passwordEntry?.get_text() ?? '';
           if (!pw) return;
           greeter.postAuth(pw);
           passwordEntry?.set_text('');
       }
   };
   ```
2. **`src/widget/greeter/index.tsx`** — default username to `''` (not `GLib.get_user_name()`); bind `Adw.Avatar` `text` to the username state; replace the hardcoded session command:
   ```ts
   const sessionCmd = (GLib.getenv('SHADE_SESSION_COMMAND') ?? 'Hyprland').split(' ');
   greeter.startSession(sessionCmd);
   ```
3. **`src/widget/greeter/GreetSession.ts`** — quit on success: call the app-provided `onSessionStarted` callback (or `exit(0)`) after `start_session_finish` succeeds; wrap `new Greet.Greeter()` + `create_session` in try/catch → `error` state with message (E1).
4. **`src/lib/__tests__/greeter.test.ts`** — GreetSession state machine transitions with a mocked Greet (idle → creating-session → awaiting-input → authenticating → authenticated/error; cancelled → re-create). Follow the existing esbuild + `gjs -m` test pattern; register in `package.json` `test`.
5. **`nix/module.nix`** — add options:
   ```nix
   greeter = {
     enable = lib.mkEnableOption "Shade greetd greeter (replaces other display managers)";
     sessionCommand = lib.mkOption {
       type = lib.types.str;
       default = "Hyprland";
       description = "Command greetd runs as the user after successful authentication";
     };
   };
   ```
6. **`nix/module.nix`** — config block (new `mkIf cfg.greeter.enable`):
   ```nix
   # greetd's config has no per-session `environment` key — export via wrapper:
   services.greetd = {
     enable = true;
     settings.default_session = {
       command = let
         greeterSession = pkgs.writeShellScript "shade-greeter-session" ''
           export SHADE_SESSION_COMMAND=${lib.escapeShellArg cfg.greeter.sessionCommand}
           exec ${pkgs.cage}/bin/cage -s -- ${cfg.package}/bin/shade-shell-greet
         '';
       in "${greeterSession}";
       user = "greeter";
     };
   };
   ```
7. **flake.nix** — confirm `cage` available to the module (`pkgs.cage`, no flake change needed; remove `greetd` from `wrapperPackages` if unused at runtime by the shell itself).
8. **Docs** — update `docs/specs/greeter.md` with a "Deployment (NixOS)" section.
9. **Manual test (VM)** — `nixosConfigurations.vm` exists; add greeter enable to a VM config and verify: boot → greeter → wrong password (F4 error) → login (F5 session start). Check `journalctl -u greetd` and `_COMM=shade-shell-greet`.

### Verification

- `nix build .#nixosConfigurations.vm.config.system.build.vm` succeeds.
- Greeter appears on boot in VM; F1–F5 from the spec pass; `journalctl --user _COMM=shade-shell-greet` clean.

---

## Phase 2 — Clipboard history sync

### Findings (root causes, by debugging the data flow)

Copy → `Gdk.Clipboard.changed` → `onClipboardChanged` (debounce 300 ms) → `readClipboardContent` → `addEntry` → `encryptedStore.addEntry` (in-memory array + full re-encrypt to disk). UI reads via `launcherSearch()` → `searchHistory()`.

0. **Focus-gated capture (primary, protocol-level).** On Wayland the regular clipboard (`wl_data_device`, wrapped by GTK4 `Gdk.Clipboard`) delivers selection events against the *focused* surface's serial. A background shell isn't focused when the user copies in another app → `changed` is missed/delayed and reads are unreliable. This is the mechanical explanation for "doesn't sync everything". The correct mechanism for clipboard *managers* on Hyprland is `wlr-data-control-unstable-v1` (supported by Hyprland; stable successor: `ext-data-control-v1`). GJS can't bind raw Wayland protocols and neither Hyprland nor Astal ships a clipboard library, so the capture layer becomes a `wl-paste --watch` subprocess (wl-clipboard uses data-control in watch mode — focus-independent).
   - **Not** cliphist: its history db is plaintext (`~/.cache/cliphist`), conflicting with the encrypted-at-rest design.
1. **No change notification.** `encryptedStore.ts` keeps entries in a module-local array with zero signals/subscriptions. Any open view (applauncher clipboard mode `>`, future clipboard widget) renders a stale snapshot until the user retypes the query. Nothing ever pushes updates.
2. **`skipNextChange` boolean race.** Set before `clipboard.set()`/`set_content()`, consumed by *whichever* `changed` fires next — including one from another app. Multi-mime `set_content` can also emit `changed` more than once → second emission re-adds our own entry (duplicate) or an external copy is swallowed.
3. **Format coverage.** Only `read_text_async`, then `read_texture_async` as fallback. No `clipboard.get_formats()` inspection — file copies (text/uri-list), rich text, and non-texture image mimes are silently dropped.
4. **Dedup only against the newest entry** (`entries[0]`). Re-copying an older item creates a duplicate instead of moving it to front.
5. **Images bypass encryption** — saved as plaintext PNGs in `~/.local/share/shade-shell/clipboard/`, violating the encrypt-at-rest motivation of `2026-07-13-encrypted-clipboard-history-design.md`.
6. **Perf:** every mutation re-serializes and re-encrypts the whole history (`saveEncryptedFile` on each add/delete/pin).

### Design

Two-layer redesign per the service–widget boundary spec (`2026-07-18-service-widget-boundary-design.md`):

**Capture layer (new: `clipboardWatcher.ts`)** — native wlroots capture via subprocess:

- Two long-running `Gio.Subprocess` watchers, one per class:
  - `wl-paste --no-newline --type text --watch sh -c 'base64 -w0; echo'`
  - `wl-paste --type image --watch sh -c 'base64 -w0; echo'`
  - Each clipboard change emits one base64 line on wl-paste's stdout → parse with a `GDataInputStream.read_line_async` loop → decode → `addEntry`.
  - `wl-paste --watch` uses data-control → fires regardless of focus, and fires once on startup with the current selection (deletes the 1 s `GLib.timeout` startup hack and the 300 ms debounce — data-control sends one event per actual selection change).
- `wl-clipboard` added to `wrapperPackages` in `flake.nix`.
- A copy offering both `text/*` and `image/*` fires both watchers → the move-to-front dedup (below) plus a short same-timestamp window guard absorbs the double event.
- Setting the clipboard stays on `Gdk.Clipboard` (works: the launcher is focused when picking an entry). Echo suppression: remember the hash of the last content we set; skip one watcher event matching it.
- GDK `changed` path is deleted, not kept as fallback — the Nix wrapper guarantees `wl-paste` is on PATH; log loudly if spawn fails.

**Store layer** — convert `encryptedStore.ts` into a proper GObject service:

- `ClipboardHistory extends GObject.Object` with an `entries` property (`notify::entries` on every mutation) — gnim `createBinding` consumers update for free.
- Dedup = move-to-front: if content exists anywhere in history, move it (and bump timestamp) instead of duplicating.
- Encrypt images: store PNG bytes base64 inside the encrypted blob (entries are capped at 100; acceptable) and delete the plaintext directory, or encrypt files individually with the same key. Decide during implementation; blob is simpler.
- Keep the module-level public API as thin delegates so `launcher.ts`, `clipboardButton.tsx`, and the deprecated `index.ts` wrapper keep working; migrate consumers to bindings after.

### File map

| File | Change |
|------|--------|
| `src/lib/services/clipboard/clipboardWatcher.ts` | New: wl-paste subprocess watchers (text + image), base64 line framing, echo-hash suppression |
| `src/lib/services/clipboard/encryptedStore.ts` | Becomes GObject class with `notify::entries`; move-to-front dedup; image bytes in blob |
| `src/lib/services/clipboard/history.ts` | Deletes GDK `changed` wiring + debounce + startup timeout; delegates to watcher + service singleton |
| `flake.nix` | Add `wl-clipboard` to `wrapperPackages` |
| `src/lib/services/search/launcher.ts` | Expose/bind service for reactive clipboard results |
| `src/widget/applauncher/index.tsx` | Re-query on `notify::entries` when in clipboard mode |
| `src/lib/__tests__/clipboard.test.ts` | New: store notifications, echo suppression, move-to-front, roundtrip encrypt/decrypt |
| `package.json` | Add clipboard test to the `test` script build/run list |

### Tasks

1. Add debug logging at each chain step (`changed` fired, formats available, entry stored); verify against `journalctl --user _COMM=shade-shell -f` with real copies **from unfocused apps** (text, image, file in Nautilus) — confirm the missed `changed` events hypothesis before changing logic, per project debugging methodology.
2. Write `clipboardWatcher.ts`: spawn watchers, line-parse loop, base64 decode, restart-on-exit with backoff, clean shutdown on service stop.
3. Wire watcher → `addEntry` with echo-hash suppression; delete `skipNextChange`, the debounce, and the startup timeout from `history.ts`.
4. Add `wl-clipboard` to `wrapperPackages` in `flake.nix`.
5. GObject-ify `encryptedStore.ts` (`@register`, `entries` getter + `notify`), keep function delegates.
6. Move-to-front dedup in `addEntry`.
7. Image bytes into encrypted blob; migration: on load, import existing plaintext PNGs, then delete the directory.
8. Write `clipboard.test.ts` (follow the existing esbuild + `gjs -m` test pattern); add to `package.json` `test` script. Watcher parsing is unit-testable without Wayland by feeding the line parser synthetic base64 lines.
9. Bind applauncher clipboard mode to `notify::entries`.
10. Update `docs/superpowers/specs/2026-07-13-encrypted-clipboard-history-design.md` status notes where reality diverged (capture layer, images, notifications).

### Verification

- `pnpm test` passes including new clipboard tests.
- Manual matrix with shell running and **focus in another app**: copy text / copy image / copy file / copy same item twice / copy from history back — each reflected immediately in `>` mode without retyping; journal shows one entry per copy, no swallowing. Copies made while the shell has no visible window must appear (the phase-0 bug).

---

## Phase 3 — Screenshot / capture

### Findings

Mutter/GNOME-style interactive overlay, partially working after repeated fixes (`f7aa62cc`, `dded3bb0`):

- Working pieces: fullscreen grim path, overlay widget (`src/widget/screenshot-ui/`), recorder (wf-recorder/wl-screenrec), share-picker app for XDPH.
- Fragile pieces:
  - **Geometry conversions.** grim (`x,y WxH` global) ↔ magick (`WxH+X+Y` monitor-local) conversions live in `stage.ts`/`captureFlow.ts`; `grimToMagickGeometry` uses `focused_monitor` — wrong when the selection is on a non-focused monitor. Multi-monitor is the broken case.
  - **Freeze/stage duality.** With wayfreeze: crop from a captured stage frame (`captureFromStage`); without: live `grim -g` (`captureGeometry`). Two code paths for the same outcome, diverging behavior, both kept alive.
  - **Overlay close timing** via fixed 150 ms timeouts (`OVERLAY_CLOSE_DELAY_MS`) — race-prone.
- Effort to date: spec complete (`docs/specs/screenshot-ui.md`), drawing/selection implemented; geometry + lifecycle bugs are what remains.

### Decision gate (do this first)

**Option A — finish the GNOME-style overlay** (recommended if multi-monitor geometry can be fixed in the spike): keep stage/freeze, fix coordinate transforms properly, add tests.
**Option B — simplify**: fullscreen/area via grim+slurp (hyprshot already shipped by the module), recording via wl-screenrec; delete stage/freeze/magick paths and screenshot-ui overlay; keep share-picker untouched. Lower maintenance, loses the frozen-frame GNOME UX.

**Spike (timebox ~half a day), then decide:**
1. Reproduce on multi-monitor: area screenshot on the non-focused monitor → confirm wrong-crop bug (`grimToMagickGeometry`).
2. If the fix is a contained per-monitor transform (use `AstalHyprland` monitor list, pick monitor containing the selection origin) → Option A. If stage frame capture itself is unreliable → Option B.

### Option A tasks

1. Fix `grimToMagickGeometry`: derive the monitor from the selection's origin point via `AstalHyprland.get_default().monitors`, not `focused_monitor`.
2. Single coordinate type at boundaries: convert to monitor-local once in `captureArea`, pass explicit `{x,y,width,height}` struct internally instead of stringly-typed geometry (kill the dual-format comments).
3. Replace `OVERLAY_CLOSE_DELAY_MS` guesses with `unmap`/`hide` signal-driven continuation where GTK allows.
4. Extend `src/lib/__tests__/screenshot.test.ts`: geometry transform matrix (1 monitor, 2 monitors side-by-side, vertical stack, scaled monitor).
5. Manual matrix per spec F1–F7 on one and two monitors; check `journalctl --user _COMM=shade-shell`.

### Option B tasks

1. `screenshot()` fullscreen: keep grim path as-is.
2. Area: `slurp` → `grim -g`; delete `stage.ts`, `freeze.ts`, `captureFlow.ts` stage branches, `screenshot-ui` overlay (or reduce to a minimal mode picker).
3. Keep recorder + recording boundary; wire area recording through slurp geometry.
4. Update `docs/specs/screenshot-ui.md` (mark superseded) and module docs.

### Verification (either option)

- `pnpm test` passes; capture matrix (fullscreen/area/window/monitor × screenshot/record × 1–2 monitors) produces correct crops and files; clipboard copy of the capture works (regression from `f7aa62cc`).

---

## Execution notes

- One branch per phase: `fix/greeter`, `fix/clipboard-sync`, `fix/capture-geometry` (or `refac/capture-simplify`).
- Phases are independent; no ordering constraint between 2 and 3. Phase 1 first because it's small and finishes a feature.
- Follow-ups outside this repo: consume the flake in nixfiles (desktop-manager module) and enable `programs.shade.greeter.enable` there.
