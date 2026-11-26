# Spec: Bar

> Source-linked reference for the shell bar. The current implementation is authoritative; source tracing is not runtime verification.


## Overview

- **Source**: [`packages/widgets/src/bar/`](../../packages/widgets/src/bar/) (entry: [`index.tsx`](../../packages/widgets/src/bar/index.tsx))
- **Settings group**: [`barSettings`](../../packages/services/src/settings/bar.gschema.ts)
- **Layer/behavior**: `index.tsx` creates one exclusive `Astal.Window` for each GDK monitor, anchored to the selected edge and registered with `WindowManager`.


## Functional

### Current composition and adaptation

| Behavior | Source evidence |
|---|---|
| Start: launcher/system usage; center: monitor workspaces/window title; end: Bluetooth/audio, recording, screen sharing, tray applications, clock, weather, and system indicators | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Workspace app icons update when Hyprland finishes populating a client's class or title | [`workspaces.tsx`](../../packages/widgets/src/bar/workspaces.tsx) |
| Position determines window anchor and horizontal/vertical orientation | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Vertical clock face uses four rows; horizontal placement preserves the horizontal face, and the active timer remains a single label | [`clock.tsx`](../../packages/widgets/src/bar/clock.tsx) |
| Each monitor's bar unregisters and closes on cleanup | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Bar module visibility is controlled by settings | [`bar.gschema.ts`](../../packages/services/src/settings/bar.gschema.ts) |
| Vertical width is bounded by a 48-logical-pixel native scroll viewport, shared with launcher/Quick Settings edge reservations | [`geometry.ts`](../../packages/widgets/src/bar/geometry.ts), [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Vertical title/recording/Bluetooth content stacks; long values use bounded labels and full-value tooltips; month is abbreviated | Bar leaf components |
| Vertical usage/indicator buttons remove horizontal native padding; usage labels stay bounded with full-value tooltips at enlarged fonts | [`systemUsage.tsx`](../../packages/widgets/src/bar/systemUsage.tsx), [`systemIndicators.tsx`](../../packages/widgets/src/bar/systemIndicators.tsx) |
| Focused-client title/class changes update the bounded label and tooltip without requiring a different focused window | [`windowTitle.tsx`](../../packages/widgets/src/bar/windowTitle.tsx) |
| The bar's long-axis content scrolls inside the compositor-allotted layer; the 48px width/height is the reserved cross-axis size, not a promise that every vertically stacked control fits a short output simultaneously | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Tray applications appear on the bar by default; IDs listed in `hidden-tray-items` appear only in Quick Settings. Per-item placement is controlled in Bar settings | [`index.tsx`](../../packages/widgets/src/bar/index.tsx), [`quicksettings/tray.tsx`](../../packages/widgets/src/quicksettings/tray.tsx), [`bar.tsx`](../../packages/widgets/src/settings/bar.tsx), [`bar.gschema.ts`](../../packages/services/src/settings/bar.gschema.ts) |
| External screen sharing shows only a red display icon while a real XDPH `Video/Source` node is running; its tooltip identifies the application and source when PipeWire metadata provides them. There is no sharing label, count badge or popover. Audio, webcams, and picker previews do not activate it | [`screencast.ts`](../../packages/services/src/capture/screencast.ts), [`screencastGraph.ts`](../../packages/services/src/capture/screencastGraph.ts), [`indicators/screencast.tsx`](../../packages/widgets/src/bar/indicators/screencast.tsx) |


Component-specific interactions and fallback behavior should be verified in the owning component before adding them here.

## System usage preferences

The Bar settings page exposes resource indicators and system monitoring options. These are persistent `barSettings` keys in [`bar.gschema.ts`](../../packages/services/src/settings/bar.gschema.ts); this describes configuration and source behavior, not runtime verification.

| Setting | Default | Allowed values / limits |
|---|---:|---|
| CPU, memory, temperature indicators | enabled | Independent switches |
| Network and swap indicators | disabled | Independent switches |
| Disk indicator | disabled | Existing `show-disk-usage` switch |
| Resource indicator style | `bars` | `bars`, `text`, `compact` |
| Network rate unit | `bytes` | `bytes` or `bits` |
| Sampling interval | 1000 ms | 500–5000 ms |
| Network interface | empty | Empty selects aggregate non-loopback traffic; custom interface value is retained |
| Filesystem path | `/` | Path monitored for disk usage |
| Process ordering | `cpu` | `cpu` or `memory` |
| Process count | 5 | 3–15 |
| Graphs, process list, per-core CPU | enabled | Independent switches |
| Temperature sensor path | empty | Empty requests automatic sensor selection |

Existing bar placement, dock, tray, and module-visibility preferences remain available. The usage sampling interval is a configured cadence; graph history length does not imply a fixed 60-second time window.

### Homelab metrics source

System monitoring can use either the local machine (`local`, the default) or a Homelab node_exporter endpoint (`homelab`). The remote settings are independent of the existing local sampling interval, network interface, and filesystem path:

| Setting | Default | Allowed values / limits |
|---|---|---|
| Source | `local` | `local` or `homelab` |
| node_exporter URL | `http://dvision-homelab:9100/metrics` | Metrics endpoint URL |
| Remote polling interval | 5000 ms | 2000–60000 ms |
| Remote network interface | `enp14s0` | Interface name; empty aggregates non-loopback interfaces |
| Remote filesystem path | `/` | Filesystem mount path |

The settings page separates the remote endpoint options from local monitoring settings. node_exporter HTTP is unencrypted and should only be used on a trusted LAN. Do not put credentials in the URL or persist credentials in settings.

The popup's Local/Homelab selector updates the bar and the open popup together without closing it. The remote bar icon identifies the server; initial loading and connection errors never substitute local readings. On a failed scrape the popup marks any retained last-good data as stale, while the bar shows the unavailable host rather than stale numeric indicators. Changing the URL clears the old host's readings and histories.

[`remoteSystemUsage.ts`](../../packages/services/src/monitoring/remoteSystemUsage.ts) uses asynchronous Soup requests with a three-second timeout, cancellation on source/URL changes, and one shared polling loop across bars. Polling stops when no visible bar uses the remote source. CPU and network rates need consecutive counter samples; failures do not add synthetic zero samples. The exporter supplies CPU/thread usage, memory, swap, selected network interface, filesystem mount, load and uptime. Remote temperature is explicitly the maximum exported sensor, not a claimed CPU temperature. Per-process detail, battery history and launching a system monitor remain local-only.

The usage popup uses a bounded, stable scroll viewport and a fixed four-column per-thread grid (24 threads occupy six rows). Numeric values and process slots have bounded widths. Disk capability visibility is retained during refresh rather than toggled off before every asynchronous read. Collector startup/configuration side effects run outside reactive dependency tracking so metric updates cannot repeatedly restart sampling.

Verified with real node_exporter scrapes and an unavailable endpoint: the selected host, 24 threads, RAM, NIC and filesystem were read successfully, and changing to an unavailable URL exposed an error without retaining another host's readings. An isolated GTK smoke measured unchanged popup dimensions across repeated local and homelab updates, confirmed the 4×6 grid, and switched sources through the popup control without closing it. Parser/delta tests and the local disk-refresh regression test also passed; this does not imply every theme, monitor size or bar orientation was exercised.

The portal backend publishes source kind/name and its requesting app ID on the existing PipeWire stream. If an application supplies no ID, the observer uses the linked consumer application's metadata when available; otherwise the UI explicitly leaves it unidentified. Existing streams are discovered at service startup, and stopping/removing a stream clears its indicator. This is separate from the shell's own recording timer and stop action. Updated portal metadata requires deploying the patched XDPH package; older backends still produce an honest generic activity indicator.


## Visual (Adwaita alignment)

| Element | Current class / native variable | Source |
|---------|---------------------------------|--------|
| Bar window | `bar-window`: transparent background, no shadow | [`index.tsx`](../../packages/widgets/src/bar/index.tsx), [`style.ts`](../../packages/widgets/src/style.ts) |
| Clusters (`BarCluster`) | `card` box with a 4px inner margin around flat controls | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |

The shared theme maps its palette onto native Adwaita CSS variables, including `--window-bg-color`, `--window-fg-color`, `--accent-bg-color`, `--accent-fg-color`, `--accent-color`, `--card-bg-color`, and `--shade-color`. See [`theme.ts`](../../packages/style/src/theme.ts) and the [GTK4/libadwaita style guide](../STYLEGUIDE.md). This is not a claim that the bar uses every variable directly.

## Test plan

- **Functional/manual**: inspect bar position, enabled modules, workspaces, and monitor add/remove behavior against the current source and runtime.
- **Visual/manual**: inspect horizontal and vertical layouts in supported color schemes; the isolated homelab smoke above covers the resource popup, not every bar configuration.