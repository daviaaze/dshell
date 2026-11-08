# VM radio testing

`nix/vm-vnc.nix` provides guest-local radios for exercising Shade's Wi-Fi and Bluetooth settings without passing host hardware into QEMU.

## Radios

- Wi-Fi uses two `mac80211_hwsim` radios. NetworkManager manages `wlan0`; `wlan1` hosts the isolated WPA2 test network `Shade-Test` (passphrase `shade-test`). DHCP leases are `10.42.0.10`–`10.42.0.100`; the AP address is `10.42.0.1`. The AP has no upstream internet connection.
- Bluetooth uses `hci_vhci` with BlueZ's `btvirt` test controllers. No physical Bluetooth adapter is passed through.
- The NetworkManager package override accepts Nix-store device plugins owned by UID 65534 only when they are under `/nix/store` and not owner-writable. This is needed because the VM's virtio-9p Nix-store view reports that owner; NetworkManager otherwise skips its Wi-Fi plugin. Existing group/world-write and setuid checks remain enabled.

## Build and launch

```sh
nix build .#nixosConfigurations.vm-vnc.config.system.build.vm -o /tmp/shade-vm
NIX_DISK_IMAGE=/tmp/shade-vm.qcow2 \
QEMU_NET_OPTS='hostfwd=tcp:127.0.0.1:2222-:22' \
QEMU_OPTS='-display vnc=127.0.0.1:0 -monitor unix:/tmp/shade-vm-monitor.sock,server,nowait' \
/tmp/shade-vm/bin/run-shade-vm-vm
```

The VM uses plain virtio VGA so QEMU's VNC backend can expose its screen. VNC listens on host loopback port 5900; guest SSH is forwarded only to host loopback port 2222.


### Fast visual iteration

For repeated shell/UI edits, keep one disposable VM alive instead of repeating the
full workflow boot and AT-SPI setup:

```sh
scripts/vm-dev.py up
scripts/vm-dev.py run toggle-quicksettings
scripts/vm-dev.py shot quicksettings
scripts/vm-dev.py sync
scripts/vm-dev.py shot after-sync
scripts/vm-dev.py down
```

`up` builds and boots `vm-vnc` once, logs in as the fixture user, and stores its
PID and loopback SSH/VNC ports in `/tmp/dshell-vm-dev/state.json`. `sync` builds
only `.#default` (the Shade package), then restarts the guest user service using
the new shared `/nix/store` path; it refuses to restart if Hyprland reports the
session locked or the lock state cannot be read. `shot NAME` uses guest `grim`
over SSH (use `--vnc` for pre-login/locked screens) and prints the PNG path.
`run` accepts a registered Shade action or any guest command; `key` and
`click X Y` send VNC input. `down` removes the disposable guest disk and state.
The VM build/boot still costs the initial minutes; a cold uncached Shade package
build can also exceed the ~30s sync target. Screenshots do not use AT-SPI.

This helper is separate from `vm-workflow-test.py`; existing test runs retain
their isolated-VM behavior and cleanup.

#### Fast source iteration and batched captures

`scripts/vm-dev.py` adds a fast host-side gnim bundle path, named image
diffs, and JSON scenes. It uses the VM selected by `DSHELL_VM_DEV_DIR` (default
`/tmp/dshell-vm-dev`); a separate VM can be isolated, for example, with
`DSHELL_VM_DEV_DIR=/tmp/dshell-vm-dev2`.

```sh
# After one normal `sync`, compile only apps/shell/src/main.ts and its imports
scripts/vm-dev.py fast-sync
scripts/vm-dev.py fast-sync --force

# First capture establishes a baseline; later captures retain NAME.prev.png,
# write NAME.diff.png, and report the percentage of pixels changed.
scripts/vm-dev.py shot settings --diff

# One VM attachment/command invocation for all actions and screenshots
scripts/vm-dev.py scenes scripts/vm-scenes/settings-sections.json
```

`fast-sync` runs the local `node_modules/.bin/gnim`-equivalent bundle command
with the same app id and defines as `nix/desktop-shell.nix`, then streams the
result to the guest over the already-open SSH connection. The guest runs a
patched copy of `bin/.shade-shell-wrapped` with the same gjs runtime environment
as the packaged wrapper and registers the replacement gresource at
`resource:///com/caioasmuniz/shade_shell/main.js`. Only
`shade-shell.service` is restarted; the greeter, compositor, and other shell
applications are not. The lock check is made both before bundling and again
before restarting; an unreadable compositor lock state is an error, never an
implicit unlock assumption.

The gresource is required because the generated executable wrapper hard-codes
the store gresource path and imports the `resource:///.../main.js` module; a
plain JS bundle cannot replace it. The fast path rebuilds only that gresource,
and currently needs `glib-compile-resources` as well as gnim. CSS imported by
the shell is bundled into the same resource (the widget stylesheet is also a
TypeScript template string), so there is no live CSS-only reload hook in the
running process. CSS-only edits use `fast-sync` and restart the shell; adding a
GTK provider reload mechanism would require a separate shell-code change.

`sync` records a baseline fingerprint for Nix-only inputs. Later changes to
`flake.nix`/`flake.lock`, `nix/`, `data/`, `assets/`, package manifests, or
`*.gschema.ts` are refused: run the appropriate `nix build` and full `sync` so
the package's schemas, assets, and wrappers are rebuilt. A changed VM NixOS
definition also requires rebuilding and rebooting the disposable VM. `--ignore-nix`
is available only when the caller has independently established that those
guest-side files stay compatible. The fast path does not rebuild
greeter/share-picker/auth-worker or generated schemas.

Scenes accept a top-level JSON array or `{ "steps": [...] }`. Each step is one
of `{"run":"toggle-settings"}`, `{"key":["down","enter"]}`, `{"click":[x,y]}`,
`{"sleep":0.5}`, or `{"shot":"name","diff":true}`.
Scene actions/captures are sent in one VNC connection per action segment (the
settings example uses one VNC connection for all 12 clicks and captures), and
SSH commands reuse the existing ControlMaster. `settings-sections.json` captures
12 ordered Settings navigation states; adjust its sleeps if the guest machine
is under load.

Measured on the second disposable VM (`DSHELL_VM_DEV_DIR=/tmp/dshell-vm-dev2`,
already-booted guest, cached Nix build): full `sync --force` took 1.6 s
(Nix evaluation/build 0.2 s, guest restart 1.3 s); `fast-sync` took 1.9 s
(fingerprint 0.13 s, gnim bundle 0.28 s, upload 0.06 s, guest restart 1.3 s).
The host bundle alone took 0.26 s in a direct invocation. Fast-sync therefore
avoids Nix build work, but on this warm cache its total was not faster than the
already-cached full sync; it is intended to avoid the ~52 s uncached package
build. Twelve separate `shot` commands took 1.32 s. Twelve screenshot-only
steps in one `scenes` invocation took 0.65 s. The 12-section settings scene
took 20.3 s, including explicit settling sleeps and VNC capture/navigation.

`shot --diff NAME` (spelled `shot NAME --diff`) compares with the previous
same-name capture using ImageMagick's AE changed-pixel metric and a default 1%
color fuzz. First capture prints “no previous capture”; later captures preserve
the old PNG as `NAME.prev.png` and write the difference image as `NAME.diff.png`.
This percentage is a pixel-change indicator, not a perceptual or UI correctness
judgment.

### Current UI-review evidence mode

Use `--ui-review` to run real guest workflow steps while retaining screenshots and available native/compositor receipts. It is an evidence-capture workflow, **not** a human visual review, WCAG/accessibility certification, or exact padding/conformance measurement.

```sh
# Default matrix: shell, settings-auth, capture-share × light/dark × wide/compact
python3 scripts/vm-workflow-test.py --ui-review

# Select matrix dimensions; each option may be repeated (values must be unique)
python3 scripts/vm-workflow-test.py --ui-review \
  --review-family shell --review-family capture-share \
  --review-theme dark \
  --review-viewport wide --review-viewport short
```

Families are `shell`, `settings-auth`, and `capture-share`; themes are `light` and `dark`; viewports are `wide`, `compact`, and `short`. The guest uses `Virtual-1` at 1280×800, 800×600, or 1024×480 respectively, scale 1, and selects the theme through Settings. The real greeter is a separate pre-login prerequisite, not repeated across the session matrix. Matrix flags require `--ui-review`; it cannot be combined with `--scenario` or `--list-scenarios`. Artifacts are retained under the printed run directory, in `ui-review/manifest.json` and per-screen directories.

The host dev shell provides `vncdo` with its `service-identity` Python runtime dependency so Twisted can initialize; use the normal `nix develop` environment for these workflows.

Manifest records distinguish `captured`, `failed`, and `unavailable`; a captured record has `reviewed: false`. Review screenshots are actual UI states reached during the workflow. AT-SPI allocations and compositor receipts provide supporting identity/geometry/context, **not** exact padding measurements. AT-SPI/native receipts may be unavailable or intentionally omitted, and greeter receipts are unavailable before login. Inspect images and records manually; absence of an error or a captured screenshot does not establish a visual/accessibility pass. Greeter captures are prerequisite evidence, not evidence that every family/theme/viewport greeter combination was tested.

The UI-review shell family starts guest-local real media playback with **mpv + MPRIS** (null audio/video output; it verifies guest playback/provider state, not physical audio), and starts **`nm-applet --indicator`** to inspect its native StatusNotifierItem/menu (does not change network state). These are temporary user services cleaned up by the fixture; their UI presence is not a physical-device test.

The Bluetooth VM has two guest-local `btvirt` controllers. Its peer service selects one controller using `/run/shade-vm-bluetooth/peer-address` (empty selects the default peer); the selector must be a MAC address matching one of those two controllers. The service advertises a pairable `ShadeVM-Peer` and keeps `bluetoothctl` alive so the agent/advertising state remains registered. Stop cleanup disables fixture modes and removes only the two controllers' counterpart pairing entries. This makes a guest UI pairing attempt possible; it does **not** imply that pairing succeeded, and no successful-pairing claim is made here.

Audio fixtures are distinct: a guest null sink provides a `.monitor` source for capturing generated playback signal, while a separate virtual **HDA microphone** provides an input endpoint for Sound Settings. The HDA input is not the null sink monitor, neither fixture is a host microphone/device, and successful settings interaction does not establish physical audio I/O.

```sh
# Existing multi-scenario workflow smoke test
python3 scripts/vm-workflow-test.py

# Isolated recording pilot
python3 scripts/vm-workflow-test.py --visual-audit

# Run the smoke scenarios, history check, and recording audit in one guest boot
python3 scripts/vm-workflow-test.py --full-suite

# Script-level regression tests (frame selection, accessibility, and timing)
nix develop -c python3 -m unittest discover -s scripts -p 'test_*.py'
```

`--full-suite` starts one `vm-vnc` guest, logs in once through the real greeter, then runs the default scenarios, notification-history check, and recording audit sequentially against that same guest. The newer `--ui-review` mode is a separate matrix: it captures actual workflow screenshots and available native/compositor receipts but does not perform manual review or accessibility/padding certification. Every mode uses a disposable guest disk and cleans up QEMU and disk state on exit. Guest VNC and SSH remain loopback-only; the tests never operate the host desktop or radios. The command prints its retained artifact directory.

`scripts/vm-workflow-test.py` writes `results.json` in that directory and prints
one `PASS`, `FAIL`, or `UNSUPPORTED` result per executed or explicitly excluded
scenario. `--full-suite` records known coverage exclusions as `UNSUPPORTED`;
because the current runner treats any non-PASS as a nonzero exit, an exit code
of 1 is expected until those exclusions are implemented or removed from scope.
Read the result details rather than treating that exit code alone as a feature
failure.

The final `results.json` includes total elapsed time, summed scenario time,
time outside scenarios, status counts, measured startup/shutdown phases, and
the five slowest host commands. Each `commands.log` entry also includes its
duration. This separates guest boot and setup overhead from scenario time and
identifies whether the next optimization should target Nix builds, SSH/UI
round-trips, or video evidence processing.

**Historical pilot results (not current coverage).** Earlier runs recorded passing greeter login, launcher, Quick Settings, Wi-Fi toggling, and screenshots; some runs failed the bar-position state check and synthetic-notification AT-SPI lookup. Those outcomes are retained as dated pilot history only. Use the current run's `results.json` and `ui-review/manifest.json`; do not infer current success or failure from this paragraph.

| Scenario | UI evidence | Independent guest evidence |
|---|---|---|
| Greeter login | VNC submits invalid credentials, returns to the prompt, then submits valid credentials; AT-SPI observes the greeter flow | Shade's user service and AT-SPI session become active |
| Launcher | `Super+Space` opens the launcher and `Escape` closes it; the accessible search control is inspected | Hyprland layer appears and is removed |
| Quick Settings | `Super+N` opens and closes the panel | Hyprland layer appears and is removed |
| Bar position | Settings is opened from the shell and the Bar & Dock page is selected; the position control is clicked | Bar layer geometry is checked; the saved preference value is not independently read |
| Wi-Fi | The Wi-Fi tile is clicked off and on through AT-SPI | NetworkManager reports disabled then enabled; the isolated AP scan is checked |
| Screenshot | The overlay is opened and cancelled, then opened again and explicitly confirmed | A new screenshot appears in the disposable guest's output directory |
| Notifications/DND | A synthetic guest notification is sent; the Notification Center and its DND control are inspected | Active notification visibility and DND state are checked when accessible |
| Notification history (`--full-suite`) | A uniquely titled synthetic notification is opened in the History view | The same summary is present in `~/.cache/shade/notifications.json` |

The default smoke suite does **not** cover Wi-Fi credential entry or connection to `Shade-Test`; it only scans the guest-local AP. In its guest-session variants, the extended workflow records excluded scenarios as `UNSUPPORTED`, not passing tests. A guest-local Bluetooth peer now makes a pairing attempt possible, but does not establish pairing success. Current audio fixture limits, including the distinction between the null-sink monitor and virtual HDA input, are described above. The VM has only `Virtual-1` unless another fixture is explicitly created, no guest portal requester is established, and biometric and destructive power actions remain excluded.

Notification/DND coverage requires reliable notification delivery and accessible controls. A failed AT-SPI lookup is not evidence that the feature is absent. Screenshots show rendered pixels, not by themselves widget identity, user interaction, or a pass. The older `--visual-audit` temporal review and newer `--ui-review` evidence mode are distinct; `--full-suite` runs the former after its shell scenarios, while `--ui-review` runs its own selected matrix.


AT-SPI name/role searches still scan the bounded tree to prove a result is unique,
but fetch screen bounds only for that unique match. This avoids a geometry D-Bus
request for every node visited. Harness tree snapshots use `--no-bounds` and
`--max-depth 10` because those evidence files need bounded semantic structure,
not per-node geometry. Live `find`/`click` searches retain their depth-16 limit;
the helper's default `tree` command still includes bounds.

The recording mode enables compositor animations inside the disposable guest and
supervises `wf-recorder` with a guest user service. It records the full compositor,
not repeated VNC screenshots, then waits for recorder exit before copying the MP4.
Virtual user input still reaches the guest over loopback VNC.

Artifacts:

- `visual-audit.mp4`: continuous full-screen recording.
- `visual-audit-events.json`: host-dispatch time windows and observed step outcomes.
- `visual-audit.json`: journey findings, timing limits, screenshots, decoded frame PTS,
  component regions, keyframe PNGs, and contact-sheet paths.
- `visual-*.png` and `*-atspi-tree.json`: native-resolution states and accessible structure.
- `visual-full/`, `visual-panel/`, `visual-wifi-tile/`, `visual-notification-card/`:
  full-screen and component-specific transition evidence.

The pilot checks Quick Settings opening/closing, Wi-Fi radio effects, notification
presence, and title-region clearing after dismissal. Notification closing and the
fine component regions deliberately use the observed 1280×800 light-theme left-panel
fixture; unsupported panel geometry is reported, not clicked blindly. Its notification
close control currently has no accessible name. An incomplete AT-SPI search does not
establish absence; dismissal is checked against rendered title pixels instead.

Frame analysis streams downscaled 64×64 grayscale crops and selects the first/last
frames, both sides of at most six strongest transitions, and frames at each action
window's start/midpoint/end. Event samples remain even when animation dominates the
change ranking or expected feedback produces no large visual change. It rejects
recordings above 18,000 probed frames. This is a review aid, not proof that tiny
text/color defects or every transient are absent. The high-resolution state captures
complement the transition selection. Timing windows include recorder-start uncertainty
and command round trips; do not interpret them as measured sub-frame response latency.

Selected native-resolution ROI frames are extracted together in one FFmpeg pass
per region; `visual-audit.json` records the video decode-pass count. This replaces
one video decode per selected frame while preserving source-frame order and
timestamps.

Review the native-resolution component PNGs with `decomposed-visual-ux-audit`:
separate style, grouping, spacing, copy, duplication, affordance, and temporal-state
passes; relate findings back to the full frame and action window. No local vision-model
inference or VRAM benchmark is performed by this command. A reachable GPU/model
service is a separate prerequisite for that comparison.


### Shared omp review tool

`decomposed-visual-ux-audit` and the `analyze_video` tool are installed at user scope
for both `omp` and `omp-work`, independently of this checkout or the current directory.
The shared extension is `~/.omp/agent/extensions/video-analysis/`; the work profile
links to the same implementation and canonical managed skill. Profile configuration
and automatic extension/skill discovery preserve availability when a project overrides
its `extensions` list. Restart existing sessions or use `/reload-plugins`.

Pass a retained recording as `video_path`, optionally with named component `regions`
(`label`, `x`, `y`, `width`, `height`) and event-centered `sample_times` in video PTS
seconds. The tool creates full-screen context, exact native-pixel crops (including odd
dimensions), contact sheets, and a manifest in a unique temporary directory unless
`output_dir` is specified. It supports four component regions and 48 event samples.
Python 3 and FFmpeg/ffprobe are used from PATH, or supplied through `nix shell` on Nix.
The global tool extracts evidence; the skill guides component-level judgments. Neither
performs GPU inference or claims that every transient/visual defect was detected.

