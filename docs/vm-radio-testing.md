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

## Automated workflow and temporal review

```sh
# Existing multi-scenario workflow smoke test
python3 scripts/vm-workflow-test.py

# Isolated recording pilot: Quick Settings, Wi-Fi off/on, notification arrival/close
python3 scripts/vm-workflow-test.py --visual-audit

# Frame-selection regression tests (real FFV1 and H.264 fixtures)
nix develop -c python3 -m unittest discover -s scripts -p test_vm_visual_evidence.py
```

Both workflow modes build the existing `vm-vnc` target, create a disposable guest disk,
log in through the real greeter, and clean up QEMU and disk state on exit. They never
operate the host desktop or radios. The command prints its retained artifact directory.

### Workflow smoke results and limits

`scripts/vm-workflow-test.py` writes `results.json` in the retained artifact
directory and prints one `PASS`, `FAIL`, or `UNSUPPORTED` result per scenario.
The JSON and scenario logs are the run-specific record; the suite is not a
release gate unless every required scenario passes.

Across the completed pilot runs, greeter login, launcher, Quick Settings,
Wi-Fi radio toggling, and screenshot capture have passed. Bar-position
selection/state verification and finding the synthetic notification through
AT-SPI have failed in some runs. Check the current run's `results.json`; do not
assume those outcomes are fixed or treat the suite as green.

| Scenario | UI evidence | Independent guest evidence |
|---|---|---|
| Greeter login | VNC submits invalid credentials, returns to the prompt, then submits valid credentials; AT-SPI observes the greeter flow | Shade's user service and AT-SPI session become active |
| Launcher | `Super+Space` opens the launcher and `Escape` closes it; the accessible search control is inspected | Hyprland layer appears and is removed |
| Quick Settings | `Super+N` opens and closes the panel | Hyprland layer appears and is removed |
| Bar position | Settings is opened from the shell and the Bar & Dock page is selected; the position control is clicked | Bar layer geometry and the saved setting are checked; failures are reported, not treated as passes |
| Wi-Fi | The Wi-Fi tile is clicked off and on through AT-SPI | NetworkManager reports disabled then enabled; the isolated AP scan is checked |
| Screenshot | The overlay is opened and cancelled, then opened again and confirmed with the screenshot shortcut | A new screenshot appears in the disposable guest's output directory |
| Notifications/DND | A synthetic guest notification is sent; Quick Settings and its DND control are inspected | Notification history and DND state are checked when accessible |

This pilot does **not** cover Wi-Fi credential entry or connection to `Shade-Test`;
it verifies the radio toggle and AP visibility only. Notification/DND coverage
requires reliable notification delivery and accessible controls. A failed
AT-SPI lookup is not evidence that the underlying feature is absent. Screenshots
prove rendered pixels only, not widget identity or successful user interaction.
The recording/temporal review described below is a separate visual sampling
workflow, not additional proof of these pilot scenarios.

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

