"""Real guest-application providers for shell media and StatusNotifier UI review."""

import json
import shlex

MEDIA_UNIT = "shade-ui-review-mpv"
TRAY_UNIT = "shade-ui-review-nm-applet"
VIDEO = "/tmp/shade-ui-review-media.mkv"


def run_review(t, theme: str, viewport: str) -> list[dict]:
    records = []
    started_units = []
    journey_error = None

    def capture(name, notes=None):
        record = t.review_capture("shell-" + name, notes=notes)
        records.append(record)
        return record

    def desktop(command, label, *, check=True):
        return t.desktop(label, command, timeout=45, check=check)

    def unit_state(unit):
        result = desktop(
            "systemctl --user show " + shlex.quote(unit + ".service")
            + " --property=LoadState --property=ActiveState",
            "inspect own provider unit " + unit, check=False,
        )
        state = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
        if not state.get("LoadState") or not state.get("ActiveState"):
            raise RuntimeError(f"Cannot inspect provider unit {unit}: {result.stdout!r} {result.stderr!r}")
        if result.returncode and state["LoadState"] != "not-found":
            raise RuntimeError(f"Cannot inspect provider unit {unit}: {result.stderr}")
        return state

    def stop_owned(unit):
        if unit_state(unit)["LoadState"] == "not-found":
            return
        result = desktop("systemctl --user stop " + shlex.quote(unit + ".service"),
                         "stop own provider unit " + unit, check=False)
        state = unit_state(unit)
        if result.returncode and state["LoadState"] != "not-found":
            raise RuntimeError(f"Cannot stop own provider unit {unit}: {result.stderr}; state={state}")
        if state["ActiveState"] not in ("inactive", "failed"):
            raise RuntimeError(f"Own provider unit remains active {unit}: {state}")

    def network_sni():
        payload = json.loads(desktop(
            "busctl --user --json=short get-property org.kde.StatusNotifierWatcher"
            " /StatusNotifierWatcher org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems",
            "discover real StatusNotifierItems",
        ).stdout)
        matches = []
        for item in payload["data"]:
            bus, separator, suffix = item.partition("/")
            path = "/" + suffix if separator else "/StatusNotifierItem"
            identity = json.loads(desktop(shlex.join([
                "busctl", "--user", "--json=short", "get-property", bus, path,
                "org.kde.StatusNotifierItem", "Id",
            ]), "identify registered StatusNotifierItem application").stdout)["data"]
            pid_data = json.loads(desktop(shlex.join([
                "busctl", "--user", "--json=short", "call", "org.freedesktop.DBus",
                "/org/freedesktop/DBus", "org.freedesktop.DBus",
                "GetConnectionUnixProcessID", "s", bus,
            ]), "identify StatusNotifierItem process").stdout)
            pid = int(pid_data["data"][0])
            comm = desktop("cat /proc/" + str(pid) + "/comm", "identify real tray application").stdout.strip()
            if identity == "nm-applet":
                # Nix's nm-applet wrapper execs the hidden packaged binary; Linux
                # truncates its comm to ".nm-applet-wrap". Compare executables,
                # not that mutable and truncated process name.
                expected_exe = desktop(
                    'applet=$(command -v nm-applet) && wrapper=$(readlink -e "$applet")'
                    ' && readlink -e "$(dirname "$wrapper")/.nm-applet-wrapped"',
                    "identify installed NetworkManager applet executable",
                ).stdout.strip()
                process_exe = desktop(
                    "readlink -e /proc/" + str(pid) + "/exe",
                    "identify StatusNotifierItem executable",
                ).stdout.strip()
                if not expected_exe or process_exe != expected_exe:
                    raise RuntimeError(
                        f"StatusNotifierItem claims nm-applet but executable is {process_exe!r}"
                        f" (expected {expected_exe!r}, comm {comm!r}): {bus}"
                    )
                title = json.loads(desktop(shlex.join([
                    "busctl", "--user", "--json=short", "get-property", bus, path,
                    "org.kde.StatusNotifierItem", "Title",
                ]), "read real tray application title").stdout)["data"]
                if not isinstance(title, str) or not title.strip():
                    raise RuntimeError(f"NetworkManager StatusNotifierItem has no usable title: {bus}")
                matches.append({"service": bus, "object_path": path, "pid": pid, "id": identity, "process_comm": comm, "process_exe": process_exe, "expected_exe": expected_exe, "Title": title})
        if len(matches) > 1:
            raise RuntimeError(f"Ambiguous NetworkManager StatusNotifierItems: {matches!r}")
        if matches:
            return matches[0]
        return None

    def dbus_get(service, prop):
        command = shlex.join([
            "busctl", "--user", "--json=short", "get-property", service,
            "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", prop,
        ])
        payload = json.loads(desktop(command, "read MPRIS " + prop).stdout)
        return payload["data"]

    def wait_status(service, expected):
        return t.wait_until("real MPRIS status " + expected,
                            lambda: dbus_get(service, "PlaybackStatus") == expected,
                            timeout=15, interval=0.25)

    def open_other_controls():
        t.close_quick_settings()
        t.open_quick_settings()
        t.wait_until("Quick Settings layer", lambda: next((x for x in t.layers() if x.get("namespace") == "shade-quicksettings"), None), timeout=15)
        node = t.wait_until("Other controls button", lambda: t.find_accessible_node("Outros controles", role="button", contains=True), timeout=12)
        t.click_accessible_node(node, "open Other controls")
        t.wait_until("Other controls page", lambda: t.find_accessible_node("Outros controles", role="window"), timeout=12)
        t.vnc("wait for Other controls page", "pause", "0.3")

    try:
        desktop("ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=640x360:rate=24' -f lavfi -i 'sine=frequency=440:sample_rate=48000' -t 90 -metadata title='Shade UI review — real guest media' -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac " + shlex.quote(VIDEO), "generate guest-local media fixture")
        argv = ["mpv", "--no-config", "--ao=null", "--vo=null", "--force-window=no", "--idle=no", "--keep-open=yes", "--input-ipc-server=/tmp/shade-ui-review-mpv.sock", VIDEO]
        desktop("systemd-run --user --unit=" + MEDIA_UNIT + " --collect --property=Type=simple -- " + shlex.join(argv), "start MPRIS-enabled mpv unit")
        started_units.append(MEDIA_UNIT)
        def mpris_service():
            payload = json.loads(desktop(
                "busctl --user --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ListNames",
                "discover mpv MPRIS service",
            ).stdout)
            return next((name for name in payload["data"][0]
                         if name.startswith("org.mpris.MediaPlayer2.mpv")), None)
        service = t.wait_until("mpv MPRIS service name", mpris_service, timeout=25)
        t.wait_until("mpv MPRIS PlaybackStatus", lambda: dbus_get(service, "PlaybackStatus") in ("Playing", "Paused"), timeout=20)
        wait_status(service, "Playing")
        metadata = dbus_get(service, "Metadata")

        open_other_controls()
        title = t.wait_until("media widget shows actual fixture", lambda: t.find_accessible_node("Shade UI review", role="label", contains=True), timeout=15)
        capture("media-controls-playing", {"provider": "mpv", "mpris_service": service, "metadata": metadata, "title_node": title, "guest_playback_only": True, "physical_audio_output_verified": False})
        play = t.wait_until("native media pause button", lambda: t.find_accessible_node("Pause", role="button", contains=True), timeout=12)
        t.click_accessible_node(play, "pause real mpv through shell media widget")
        wait_status(service, "Paused")
        capture("media-controls-paused", {"provider": "mpv", "observed_mpris_playback_status": "Paused", "guest_playback_only": True, "physical_audio_output_verified": False})
        resume = t.wait_until("native media play button", lambda: t.find_accessible_node("Play", role="button", contains=True), timeout=12)
        t.click_accessible_node(resume, "resume real mpv through shell media widget")
        wait_status(service, "Playing")

        existing = network_sni()
        if existing is None:
            desktop("systemd-run --user --unit=" + TRAY_UNIT + " --collect --property=Type=simple -- nm-applet --indicator", "start real NetworkManager AppIndicator")
            started_units.append(TRAY_UNIT)
        sni = existing or t.wait_until("real nm-applet StatusNotifierItem registration", network_sni, timeout=20)
        menu_path = json.loads(desktop(shlex.join([
            "busctl", "--user", "--json=short", "get-property", sni["service"],
            sni["object_path"], "org.kde.StatusNotifierItem", "Menu",
        ]), "read NetworkManager StatusNotifierItem menu path").stdout)["data"]
        if not isinstance(menu_path, str) or not menu_path.startswith("/") or menu_path == "/":
            raise RuntimeError(f"NetworkManager StatusNotifierItem has no DBusMenu: {menu_path!r}")
        menu_layout = json.loads(desktop(shlex.join([
            "busctl", "--user", "--json=short", "--", "call", sni["service"], menu_path,
            "com.canonical.dbusmenu", "GetLayout", "iias", "0", "-1", "0",
        ]), "read real NetworkManager DBusMenu layout").stdout)
        layout_data = menu_layout.get("data")
        if (not isinstance(layout_data, list) or len(layout_data) != 2
                or not isinstance(layout_data[1], list) or len(layout_data[1]) != 3
                or layout_data[1][0] != 0 or not layout_data[1][2]):
            raise RuntimeError(f"NetworkManager DBusMenu layout is unavailable or empty: {menu_layout!r}")
        names = [str(sni["Title"]).casefold()]
        def native_tray_item():
            tree = t.accessibility_tree("locating the real tray provider by its current metadata")
            matches = [
                node for node in t.walk_accessibility(tree)
                if node.get("role") == "button"
                and any(name in str(node.get("native_name", node.get("name", ""))).casefold()
                        for name in names)
            ]
            if len(matches) > 1:
                raise RuntimeError(f"Ambiguous native tray provider for {sni!r}: {matches!r}")
            return matches[0] if matches else None
        tray = t.wait_until("native NetworkManager StatusNotifierItem", native_tray_item, timeout=20)
        capture("tray-item", {"provider": "networkmanagerapplet nm-applet --indicator", "sni": sni, "reused_existing_process": existing is not None, "native_name": tray.get("native_name"), "bus": tray.get("bus"), "path": tray.get("path"), "network_state_changed": False})
        measured = t.accessibility(
            "measure native tray menu target", "find", "--bus", str(tray["bus"]),
            "--path", str(tray["path"]), "--name=" + tray.get("native_name", tray["name"]),
            "--role", tray["role"], "--window-bounds",
        )
        bounds = measured["window_bounds"]
        surfaces = [surface for surface in t.layers() if surface.get("namespace") == "shade-quicksettings"]
        if len(surfaces) != 1:
            raise RuntimeError(f"Tray has no unique mapped Quick Settings surface: {surfaces}")
        surface = surfaces[0]
        if (bounds[0] < 0 or bounds[1] < 0 or bounds[2] <= 0 or bounds[3] <= 0
                or bounds[0] + bounds[2] > surface["w"] or bounds[1] + bounds[3] > surface["h"]):
            raise RuntimeError(f"Tray native bounds are outside its actual surface: {measured}, {surface}")
        def tray_menus():
            tree = t.accessibility_tree("inspect NetworkManager tray menu accessibility")
            targets = [node for node in t.walk_accessibility(tree)
                       if node.get("bus") == tray.get("bus") and node.get("path") == tray.get("path")]
            if len(targets) != 1:
                raise RuntimeError(f"NetworkManager tray accessible target is not unique: {targets!r}")
            branch = list(t.walk_accessibility(targets[0]))
            incomplete = [node for node in branch if "error" in node or "truncated" in node]
            if incomplete:
                raise RuntimeError(f"NetworkManager tray accessibility branch is incomplete: {incomplete!r}")
            return [node for node in branch if node.get("role") == "menu"]

        if tray_menus():
            raise RuntimeError("Cannot prove NetworkManager menu opening: menu already exposed before click")
        t.vnc("open actual NetworkManager DBusMenu by native bounds", "move",
              str(surface["x"] + bounds[0] + bounds[2] // 2),
              str(surface["y"] + bounds[1] + bounds[3] // 2), "click", "1")
        menus = t.wait_until("NetworkManager tray menu exposed after click", tray_menus, timeout=8)
        current_sni = network_sni()
        if current_sni != sni:
            raise RuntimeError(f"NetworkManager StatusNotifierItem changed during menu opening: {sni!r} -> {current_sni!r}")
        capture("tray-menu", {"provider": "NetworkManager AppIndicator DBusMenu", "sni": sni,
                              "dbus_menu_path": menu_path, "dbus_menu_layout": menu_layout,
                              "native_target": measured, "surface": surface, "accessible_menus": menus,
                              "menu_open_evidence": "menu appeared under the tray target after click",
                              "menu_item_activation_verified": False, "network_state_changed": False})
        t.vnc("close actual NetworkManager menu", "key", "esc")
    except Exception as error:
        journey_error = error
        for unit in started_units:
            try:
                journal = desktop(
                    "journalctl --user --no-pager -n 80 --unit="
                    + shlex.quote(unit + ".service"),
                    "record provider operation journal " + unit, check=False,
                )
                (t.artifacts / ("provider-" + unit + ".log")).write_text(
                    journal.stdout + journal.stderr, encoding="utf-8"
                )
            except Exception as journal_error:
                error.add_note("Provider journal also failed: " + repr(journal_error))
        try:
            capture("provider-journey-failure", {"exception": repr(error), "guest_playback_only": True})
        except Exception as capture_error:
            error.add_note("Failure capture also failed: " + repr(capture_error))
        raise
    finally:
        cleanup_errors = []
        operations = [
            ("close provider UI popovers", lambda: t.vnc("close provider UI popovers", "key", "esc")),
            ("close Quick Settings", t.close_quick_settings),
        ]
        operations.extend(("stop " + unit, lambda unit=unit: stop_owned(unit))
                          for unit in reversed(started_units))
        operations.append(("remove guest-local media fixture", lambda: desktop(
            "rm -f " + shlex.quote(VIDEO) + " /tmp/shade-ui-review-mpv.sock",
            "remove guest-local media fixture")))
        for label, operation in operations:
            try:
                operation()
            except Exception as error:
                cleanup_errors.append(label + ": " + repr(error))
        if cleanup_errors:
            message = "; ".join(cleanup_errors)
            if journey_error is not None:
                journey_error.add_note("Provider cleanup failures: " + message)
            try:
                records.append(t.review_record("shell-provider-cleanup-failure", "failed",
                                               reason=message))
            except Exception as record_error:
                if journey_error is not None:
                    journey_error.add_note("Cleanup failure recording also failed: " + repr(record_error))
                else:
                    raise RuntimeError("Provider cleanup failures: " + message) from record_error
            if journey_error is None:
                raise RuntimeError("Provider cleanup failures: " + message)

    return records
