# NM Access Point Crash Research — 2026-06-09

**Status:** COMPLETE → `/tmp/researcher-nm-crash.md`

**Findings summary:**
- The `nm-access-point.c:287` assertion is a race between D-Bus PropertiesChanged signals and AP removal from libnm's cache. The callback dereferences `dbobj->nmobj` after the AP was unregistered → SIGABRT.
- This is architectural (affects all NM versions using async D-Bus property processing). Specific crashes confirmed in 1.45.90, 1.42.4, 1.29.90, 1.0.4.
- `systemctl restart NetworkManager`: **YES**, nuclear fix — clears all stale D-Bus objects.
- `nmcli device wifi rescan`: **NO** — triggers a new scan but doesn't clear stale client-side D-Bus proxies.
- AstalNetwork's `wifi.accessPoints` holds direct `NM.AccessPoint` D-Bus proxy references. Property access after removal triggers the crash.
- `accesspoint.vala` does NOT check proxy validity before delegating property gets.
