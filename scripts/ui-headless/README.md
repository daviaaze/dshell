# Headless Shade UI scenes

Run the **real** `scripts/dev.sh` shell in independent Hyprland 0.57 sessions:

```sh
python3 scripts/ui-headless/run.py \
  --sizes 1280x720,1920x1080,2560x1440 --scales 1,1.5 \
  --scenes launcher,launcher-query,quicksettings,notifications \
  --jobs 2 --out /tmp/shade-ui-captures
```

The runner enters `nix develop --impure` once if its tools are missing. Python
uses only the standard library. This is a native Linux/Hyprland test, not a VM
and not a browser or a mock shell. It needs this machine's `/dev/dri/card1`,
working user/mount namespaces, and the devshell dependencies already available.
It does not install a NixOS generation or build a shell package.

## Safety and lifetime

- Each worker uses `unshare -Urm` and **mounts tmpfs over `/dev/input` before
  starting Hyprland**. Real input devices are never passed to the compositor.
- The only DRM device requested is `/dev/dri/card1`, using
  `LIBSEAT_BACKEND=noop`; `eDP-1` is disabled in the private configuration.
- Runtime/config/cache/state/data directories are private. `GSETTINGS_BACKEND`
  is `memory`, so the real dconf database is not changed. System services such
  as NetworkManager and UPower are still real: scenes are deliberately limited
  to panel toggles, typing and pointer input. Do not add power/lock actions.
- The session bus address is read from the private Hyprland process's
  `/proc/<pid>/environ`, never from the invoking desktop's bus.
- Keyboard and pointer injection use Wayland virtual devices, not `/dev/input`.
- A watchdog kills each session after 165 seconds (maximum configurable value:
  170). Failure, SIGINT and SIGTERM all run cleanup. Only processes whose
  `XDG_RUNTIME_DIR` belongs to this invocation's temporary root are signalled;
  process names and process groups are never kill targets.
- Temporary runtime directories are removed after cleanup. The report includes
  survivor PIDs and whether the real session still has an enabled `eDP-1`.
  The only IPC sent to the real session is read-only `hyprctl monitors -j`
  before and after the run, with its original environment.

Runtime paths intentionally use the short `/tmp/shu-XXXXXXXX/<n>/r` form.
Longer paths exceed Linux's 108-byte Unix socket limit once Hyprland appends
its instance signature: Wayland may work while IPC sockets never appear.

## Output and assertions

Choose a fresh output directory. For every size/scale pair:

```text
1280x720@1.5/
  launcher.png
  launcher-query.png
  quicksettings.png
  notifications.png
  <scene>.layers.json
  <scene>.a11y.json
  baselines/<scene>.png
  hypr.lua
  hyprland.log
  compositor.log
  shell.log
  a11y.log
  a11y-registry.log
  report.json
report.json
```

A failed input step also saves `<scene>-failure.png` and its layer geometry.
Logs and captured images are preserved; disposable runtime files are not.
Exit status is `0` only when all workers/scenes pass, `1` for failure and `130`
for interruption.

Every capture checks the expected namespace, positive layer geometry, bounds
and horizontal overflow in **logical pixels**, PNG dimensions in **physical
pixels**, a nonuniform panel region, and drawn pixels against a settled closed
baseline. Panels are required to be opaque: at least 80% of the inset region
must differ from the baseline. A small unrelated toast cannot stand in for an
invisible panel. RGB differences up to 3 are ignored when comparing pixels,
because compositor dithering can change an otherwise static frame by 1–2.

Captures use `grim -l 0`: PNGs are uncompressed and larger, but grim also
disables PNG filtering at this level. This avoids expensive per-byte Python
Paeth reconstruction in parallel workers. Baseline settling uses 1/8-sized
private thumbnails; the baseline and every assertion/capture still use the
original full-resolution frame.
This behavior is explicit in grim's
[PNG writer](https://github.com/emersion/grim/blob/master/write_png.c).

Private compositor animations are disabled for deterministic captures. The
baseline must stay stable for half a second; this avoids treating wallpaper
startup/fade as a panel. GTK's normal rendering backend is unchanged; renderer
experiments can explicitly prefix the command with `GSK_RENDERER=cairo` or
`GSK_RENDERER=gl`. `--wayland-debug` records configure/buffer/commit traffic in
`shell.log`.

Fractional scales are applied in `hl.monitor`, not by resizing screenshots.
`debug.disable_scale_checks` is enabled **only in the test compositor**, since
Hyprland otherwise silently changes 1280×720@1.5 to 1.6. The report requires the
actual physical size and scale to equal the request. At 1280×720@1.5 the logical
bounds are approximately 853.33×480.

Wayland reports integer logical extents, so grim's implicit width-derived
capture scale is not always the monitor scale: 2560×1440@1.5 initially produced
a 2560×1439 PNG. The driver passes an explicit `capture_scale` compensating for
those rounded logical extents (reported separately from the unchanged monitor
`scale`). There is no padding or post-capture image resizing; the physical PNG
dimension assertion remains strict.

## Scenes and input

JSON scenes retain the `steps` shape of `scripts/vm-scenes`, but `run` is a
**GActions name**, never an arbitrary shell command. Example:

```json
{
  "namespace": "shade-launcher",
  "steps": [
    {"run": "toggle-applauncher"},
    {"wait_layer": "shade-launcher"},
    {"type": "shade-headless-no-match"},
    {"expect_text": "shade-headless-no-match"},
    {"shot": "query"},
    {"key": "Escape"},
    {"wait_closed": "shade-launcher"}
  ]
}
```

Use `--scene-dir` to load another directory. Allowed `run` actions are only
`toggle-applauncher`, `toggle-quicksettings` and `toggle-notifications`.
Other steps are `click: [x,y]`, `key`, `type`, `expect_text`, `wait_layer`,
`wait_closed` and `shot`. Names and capture paths are validated before starting
any compositor.

`Session.key("Ctrl+a")`, `Session.type("query")` and `Session.click(x,y)` are
also callable from Python. Click coordinates are logical monitor coordinates;
the driver checks the resulting cursor position. Typing uses a 30 ms key delay:
a zero-delay wtype burst lost characters while GTK processed search updates.
No Enter key is sent by the query scene, so it cannot launch an application.

## Accessibility and offline tests

Each instance starts its own `at-spi-bus-launcher` and `at-spi2-registryd` on
its private bus. GTK uses `GTK_A11Y=atspi`. The runner traverses accessible
children before reading the AT-SPI cache, since GTK populates that cache lazily.
`expect_text` checks the actual exported Text interface, not pixels or injected
application state. An unavailable registry is reported with the exact error;
it never silently makes a text assertion pass.

```sh
python3 -m unittest discover -s scripts -p test_ui_headless.py
nix-instantiate --parse nix/devshell.nix >/dev/null
```

The tests are offline and never start a compositor, contact D-Bus, grab input or
modify the user's environment. Native compositor proof is a separate explicit
runner invocation.

## Known launcher capture limitation

The user's real-session launcher is reported working. In these headless
sessions it maps with positive geometry and alpha 1, accepts a typed query,
and exports that exact query over AT-SPI, but contributes no pixels to grim.
The launcher scenes therefore remain **failures**, with `known_limitation`
metadata when only painting assertions fail. They are never silently passed.
Quick Settings and notifications retain all normal strict checks.

The investigation distinguished the client from the compositor:

- A GTK WidgetPaintable snapshot contains the complete launcher.
- With `GSK_RENDERER=cairo GDK_DISABLE=dmabuf`, WAYLAND_DEBUG shows a
  `wl_shm_pool.create_buffer` of 648×1072, stride 2592, format 0
  (8-bit ARGB8888), followed by attach, damage and commit.
- Reading that client's actual `memfd:gdk-wayland` mapping also contains the
  drawn launcher: 685,821 of 694,656 pixels had alpha 255. The compositor's
  grim capture still contained only wallpaper/bar.
- Native Vulkan, OpenGL, Cairo and Cairo with dmabuf disabled were tried.
  The native AR24→AB4H switch alone is therefore **not** an explanation.
  The traced private compositor log did not show a corresponding EGL/buffer
  import failure. Minimal full-height Astal layers paint in the same backend.

The unresolved boundary is downstream of the client's drawn buffer on this
headless path. No speculative launcher CSS, alignment, sizing or margin
changes were retained. The window's existing opaque-surface contract is intact.
Captures do not establish that the real desktop is affected.

The input driver keeps a virtual keyboard alive for the session (without
holding any key), so the otherwise device-free Wayland seat has keyboard
capability before GTK starts. Its device dump is in `devices.txt`. AT-SPI
snapshots expose a `truncated` flag if traversal reaches 2,000 nodes; an exact
text assertion still needs the requested text in the exported tree.
