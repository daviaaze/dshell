# Shade headless workflow test design

## Goal

Add a host-driven, headless end-to-end smoke harness for the repository's `vm-vnc` NixOS guest. Exercise real GTK workflows with QEMU's loopback-only VNC endpoint for virtual keyboard/pointer input, SSH for guest-side commands and assertions, and AT-SPI for accessible widget semantics when available. Do not require a host desktop capture/input portal or a human VNC viewer.

The test result must distinguish three evidence levels:

1. **UI interaction** — a virtual keyboard/pointer event reached a control, preferably located and asserted by AT-SPI.
2. **Guest effect** — state changed as expected, checked through a service API/CLI, guest settings, or an output artifact.
3. **Visual sampling** — optional guest screenshot/pixel assertion; proves rendered pixels only, not accessible identity or correct interaction.

The current `scripts/ui-test.sh` remains an opacity smoke test; it is not relabeled as workflow coverage.

## Architecture

- Add a host orchestrator under `scripts/` that uses the existing NixOS VM build target and creates a fresh temporary disk/state directory for each run. It binds SSH forwarding and VNC to `127.0.0.1`, launches QEMU with the repository's plain `virtio-vga` device (not a `virtio-vga-gl`/`egl-headless` configuration), waits for a guest-ready signal, and shuts down the QEMU process on every exit path.
- Drive UI input with the existing `vncdo` tool from the Nix development shell. Send guest commands over the loopback SSH forward. Do not use host desktop input or screenshots.
- Add a guest-side test entry point that probes AT-SPI service availability and exposes reusable operations for locating a named accessible control, reading role/name/state, and invoking its accessibility action. If required controls are not accessible, fail that scenario as `unsupported` with evidence; never report it as passed based only on an action call.
- Use GActions/`shade-shell` only to establish shell entry states or to test action routing; use virtual user input to test the actual UI path. Assert outcomes independently, e.g. guest settings value, NetworkManager device/connection state, compositor window/layer presence, notification/history state, or capture file existence.
- Keep all mutation inside a disposable VM disk and guest-local devices. Capture logs and optional screenshot artifacts under a temporary host output directory; do not copy private host data into the guest or pass through host radios.

## Initial pilot coverage

The first executable pilot validates that the harness can start and drive the guest, then covers representative low-risk paths:

- greeter: manual username/password flow, invalid-password feedback, Back, and successful login to the test account;
- shell surface: open/close launcher and Quick Settings through their visible controls, and confirm their accessible roles/names or explicit accessibility gap;
- Settings: open, search/navigate to Bar & Dock, change bar position, assert the stored guest setting and compositor geometry, then restore it within the disposable guest;
- Wi-Fi: connect to the guest-local `Shade-Test` AP, toggle Wi-Fi off/on, and assert disabled/reconnected NetworkManager state; AT-SPI assertions additionally verify the UI's status feedback;
- capture: open the overlay, cancel with Escape, then take one fullscreen screenshot and assert the new guest-side output file;
- notifications/DND: send a synthetic test notification, inspect current/history state, toggle DND, and assert the corresponding UI and guest state.

Pilot tests must have deterministic setup/teardown, explicit timeouts, stable accessible names, and per-scenario outcomes. A failure to locate an accessible control is not replaced by a blind screen-coordinate click; pointer coordinates are used only when the scenario explicitly tests pointer behavior and the fixture geometry is controlled.

## Follow-on workflow matrix and boundaries

After the pilot proves the transport and semantic-driver approach, add journeys from `docs/workflows.md` in small independent scenarios: clipboard search/copy, window switching, Bluetooth discovery, display controls, recording start/stop, share-picker select/cancel, lock/unlock, and power confirmation/cancel.

Do not claim coverage beyond the fixture capabilities:

- `btvirt` currently supplies virtual controllers but no advertising peer; adapter power and empty discovery can be tested, but pairing needs an explicitly configured virtual peripheral fixture.
- The VM's default one-output display can test single-output controls, not physical hotplug, multi-monitor hardware, or real EDID behavior. A Hyprland headless output can only support tests that explicitly exercise a virtual output.
- The greeter has no fingerprint sensor; only password/PAM paths can be covered.
- The share picker can be tested with synthetic guest sources and selection/cancel results. Do not initiate a real portal share or bypass a user's consent.
- Test the power menu's confirmation/cancel behavior by default; do not confirm guest shutdown/reboot as part of the ordinary suite.
- Recording and capture artifacts stay on the temporary guest disk; never test against host paths or clipboard contents.

## Acceptance

- A single documented command builds/launches the isolated VM, runs the pilot, emits per-scenario `PASS`/`FAIL`/`UNSUPPORTED` results, and cleans up the QEMU process and temporary disk on success, failure, or interruption.
- The VNC listener and SSH forward bind only to loopback; the harness never modifies host networking, host radios, or host desktop state.
- UI-driven assertions use AT-SPI or explicitly report a missing semantic driver; GAction-only activation is not accepted as proof that a user workflow works.
- Each passing pilot scenario proves a user action and an independent guest-visible effect. The test report identifies which evidence is accessibility state, guest service state, or pixels.
- Tests that require unavailable peripherals or consent are marked unsupported or isolated fixtures, not silently skipped as passes.
- Existing service-level GJS tests and `scripts/ui-test.sh` retain their current roles; the new workflow runner does not require a package build, VNC viewer, or host GUI.
