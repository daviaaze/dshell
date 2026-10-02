# Shade workflow fixes and safe coverage design

## Goal

Close the reported area-recording defect and make the disposable `vm-vnc` workflow suite cover every safe guest-local path identified in the current full-suite report. Distinguish a reproduced product defect from a missing test. A missing fixture must not be converted to `PASS` by a mock that bypasses the real Shade UI/service path.

Keep the default smoke suite and its existing role. Expand `--full-suite` as a serial run against one disposable QEMU guest and one login. Preserve loopback-only SSH/VNC and never pass through host devices, networks, or audio.

## Approaches considered

1. **Recommended — one sequential guest with guest-local fixtures.** Run existing-guest scenarios first, then enable or start isolated fixtures for Bluetooth, display, portal, brightness, audio, and fingerprint protocol checks. This preserves the current full-suite lifecycle and minimizes repeated VM boots; every fixture needs explicit setup and teardown to prevent state leakage.
2. **Separate VM profiles for each hardware domain.** Better process isolation, but duplicates VM build/startup and no longer exercises all workflows in the same disposable guest.
3. **Fix only the two reported problems.** Smaller change, but leaves all selected safe coverage gaps in `UNSUPPORTED`; this does not meet the requested “all safe guest gaps” scope.

## Architecture and execution order

`--full-suite` remains a single guest lifecycle with sequential scenarios, independent guest-state assertions, bounded waits, and per-scenario cleanup. Order tests so coordinate-sensitive and session-sensitive workflows run before any fixture changes display topology or authentication state. Lock/unlock runs late and must leave the guest unlocked. A scenario is `PASS` only when user-facing interaction and an independent guest-visible effect both match; accessibility, service state, and pixels remain distinct evidence types.

The implementation is split into these workstreams:

1. Reproduce and repair area recording with a regression assertion.
2. Make the Bar & Dock position scenario baseline-independent and deterministic.
3. Add UI/service coverage for safe workflows supported by the existing guest fixture.
4. Add isolated guest-only prerequisites and tests for the remaining safe workflows.
5. Update existing workflow and VM-test documentation to match observed results and explicit exclusions.

## Area recording

The prior VM run observed a full-output opaque-white video with a red boundary instead of the selected crop. The cause is unknown. Current source passes non-null geometry into both supported recorder argument builders, but the prior run did not record the active area-selection route, backend command, selected geometry, or decoded video dimensions.

Before changing production code, add a guest regression that records the active selection route, recorder backend/arguments, and selected rectangle, waits for recording finalization, and inspects decoded video dimensions and frame content. Use a stable test pattern generated entirely in the guest so the selected region and out-of-region content are distinguishable. Exercise both supported area-entry routes if the original route cannot be determined. Compare boundary-enabled and boundary-disabled runs; the crop must be correct in both, and the boundary must not be disabled as a workaround. Correct the first demonstrated cause only. Keep the regression on the actual user path rather than testing argument forwarding alone.

Acceptance: recorded frame dimensions equal the selected crop dimensions; selected-region content is present; content outside the crop and capture-overlay controls are absent; no opaque white full-output surface appears; the recorder exits cleanly and the artifact is removed with the disposable guest.

## Bar-position reliability

The current test requires a `Left` starting geometry to prove its first transition to `Bottom`, supports only presumed `Left`/`Bottom` click layouts, samples once after fixed sleeps, and restores through coordinates chosen from an optimistic local state. This is a harness weakness; the pilot does not prove a product defect.

Save the exact guest `bar.position` value, establish a supported test baseline, drive the visible position control, and independently assert the stored value plus compositor layer geometry. Wait with a bounded convergence check rather than a single fixed-delay sample. Restore the exact saved value in cleanup and verify the preference and geometry return; Settings closure must run even if restoration fails. Do not change the bar implementation unless a separate reproduction proves its UI or compositor behavior is wrong.

## Safe workflows using the current fixture

Add scenarios for:

- **Wi-Fi credentials:** connect only to the guest-local `Shade-Test` AP, verify the selected SSID and guest DHCP address, disconnect, remove the saved profile, and restore radio state.
- **Window-target capture:** capture a known guest window as an image and a short recording; verify the selected bounds/content and finalized file. Keep recorder audio disabled and remove artifacts.
- **Display preview/revert:** change a reversible scale/mode property on `Virtual-1`, observe the pending preview, explicitly revert, then verify the original layout. Never disable the sole output or leave an unconfirmed change active.
- **Settings navigation:** visit all 17 pages in the Settings registry and verify the selected page renders. Do not activate page controls in this registry-only scenario.
- **Window switcher:** with Settings open, open the switcher, exercise selection/focus and Escape/cancel, and verify focus returns. Never use the `Q` action that closes a client.
- **Password lock/unlock:** lock the guest session, authenticate with the disposable guest account, verify return to the unlocked session, and always unlock before proceeding.
- **Power confirmation only:** exercise the UI prompt and cancel/expire it. Do not confirm suspend, logout, reboot, or power-off; those actual actions remain explicitly unsupported.

## Guest-only fixture additions

Every fixture must be isolated from host hardware and must exercise the actual Shade-facing UI/service contract rather than fabricate a passing result.

- **Second virtual display:** provide a guest-only output for multi-output capture/display coverage. Preserve the existing primary output and run coordinate-sensitive scenarios before enabling the secondary output. Capture using measured output geometry, not assumed host dimensions.
- **Bluetooth peer:** provide an advertising/pairable peer wholly inside the guest. Verify discovery, pair/connect, and forget; stop discovery and remove the peer/device state afterward. No host Bluetooth adapter access.
- **Portal requester/backend:** establish the real guest portal and a controlled guest requester before invoking the picker. Verify source presentation and selection/cancel response; stop/release the stream and temporary files immediately. Do not use the host portal or share host content.
- **Brightness endpoint:** add a deterministic guest-local brightness device, verify slider-to-service/device feedback, restore its original value, and remove the endpoint with the disposable guest. No host backlight access.
- **Audio endpoints:** replace the host PulseAudio path with guest-local null/synthetic output and input endpoints. Exercise playback and capture using a generated guest signal, assert signal routing and endpoint controls, and restore preferences. Never capture host audio or microphone input.
- **Fingerprint protocol:** use a private guest-only D-Bus fprintd mock with controlled status signals to exercise device discovery, verification, retry, and mock-match state transition. Keep the mock and bus override scoped to the disposable guest process and remove them during cleanup. Report this as protocol/client coverage only; it does not establish a real sensor, enrollment, fingerprint-backed PAM, or real biometric security.

## Exclusions and safety

Actual suspend/logout/reboot/power-off actions remain `UNSUPPORTED`. Physical fingerprint hardware and biometric-backed authentication remain outside the claim; the mock protocol scenario is reported separately. Host Bluetooth, host display, host backlight, host network, host audio/microphone, and host desktop interaction are never used. Any scenario lacking a genuine guest-local prerequisite remains `UNSUPPORTED` with the missing fixture named; it must not be relabeled `PASS` or silently skipped.

## Verification and acceptance

- Preserve the existing default smoke behavior and run all full-suite scenarios serially in one disposable guest.
- Add a regression that fails on the observed area-recording output and passes only after decoded crop dimensions/content are correct.
- Make the Bar & Dock scenario independent of saved starting position and verify exact-state restoration.
- Make each safe workflow listed above produce both UI interaction evidence and an independent guest-side state/artifact assertion.
- Preserve cleanup on pass, failure, timeout, and interruption: stop QEMU and fixture processes; restore mutable settings/profiles; delete guest artifacts with the temporary disk.
- Keep actual power actions, physical biometric claims, and any unavailable guest fixture explicitly unsupported with reasons.
- Update existing workflow documents only after the relevant behavior has been exercised; do not claim unobserved results.
