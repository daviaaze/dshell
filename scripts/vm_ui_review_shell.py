"""Guest-only shell UI evidence journeys (loaded by vm-workflow-test)."""

import json
import math
import shlex
import time


def run_review(t, theme: str, viewport: str) -> list[dict]:
    records = []
    prefix = "shell"

    def capture(name, notes=None):
        record = t.review_capture(f"{prefix}-{name}", notes=notes)
        records.append(record)
        return record

    def unavailable(name, reason):
        records.append(t.review_unavailable(f"{prefix}-{name}", reason))

    def attempt(name, callback):
        try:
            callback()
        except Exception as error:
            # Preserve the surface before closing it, and distinguish a failed
            # interaction from a genuinely absent backend.
            record = capture(name + "-failure", {"exception": repr(error)})
            record["status"] = "failed"
            record["error"] = repr(error)
        finally:
            t.vnc("cancel shell review popup", "key", "esc")
            t.activate_shell_action("close-all")

    def layer(namespace):
        return t.wait_until(namespace + " mapped", lambda: next(
            (item for item in t.layers() if item.get("namespace") == namespace), None), timeout=15)

    def osd(name, command):
        t.desktop("trigger guest " + name, command)
        surface = t.wait_until(
            "transient OSD mapped",
            lambda: next((item for item in t.layers() if item.get("namespace") == "shade-osd"), None),
            timeout=2, interval=0.05,
        )
        identifier = f"{prefix}-{name}"
        screenshot = t.capture(str(
            t.review_directory.relative_to(t.artifacts)
            / f"{len(t.review_records):04d}-{identifier}-instant"
        ))
        records.append(t._review_capture_existing(
            identifier, screenshot,
            notes={"mapped_layer_before_screenshot": surface, "scope": "Screenshot precedes slow metadata collection; no full AT-SPI tree during the reveal timer."},
            include_native_tree=False,
        ))

    def measure_native(node):
        return t.accessibility(
            "measure exact native shell target", "find",
            "--name=" + node.get("native_name", node.get("name", "")),
            "--role", node["role"], "--bus", str(node["bus"]), "--path", str(node["path"]),
            "--window-bounds", "--include-state",
        )

    def bar_branch():
        surface = layer("shade-bar")
        tree = t.accessibility_tree("read native bar ownership")
        windows = [
            node for node in t.walk_accessibility(tree)
            if node.get("role") in ("window", "frame")
            and isinstance(node.get("bounds"), list)
            and len(node["bounds"]) == 4
            and node["bounds"][2:4] == [surface["w"], surface["h"]]
        ]
        if len(windows) != 1:
            raise RuntimeError(f"Expected one native bar window matching its unique compositor layer {surface}: {windows}")
        return windows[0]

    def bar_scrollbar():
        surface = layer("shade-bar")
        vertical = surface["h"] > surface["w"]
        matches = []
        for node in t.walk_accessibility(bar_branch()):
            if node.get("role") != "scroll bar":
                continue
            measured = measure_native(node)
            bounds = measured.get("window_bounds")
            if (isinstance(bounds, list) and len(bounds) == 4
                    and bounds[2] > 0 and bounds[3] > 0
                    and (bounds[3] > bounds[2]) == vertical):
                matches.append(node)
        if len(matches) > 1:
            raise RuntimeError(f"Ambiguous native bar long-axis scrollbar: {matches}")
        return matches[0] if matches else None

    def set_bar_scroll(node, fraction):
        return t.accessibility(
            "set native bar long-axis adjustment", "set-value",
            "--name=" + node.get("native_name", node.get("name", "")),
            "--role", node["role"], "--bus", str(node["bus"]), "--path", str(node["path"]),
            "--fraction", str(fraction),
        )

    def open_native_menu(node, label, role=None):
        if role:
            node = named(node, role=role, contains=True)
        measured = measure_native(node)
        bounds = measured.get("window_bounds")
        surfaces = [surface for surface in t.layers() if surface.get("namespace") == "shade-bar"]
        if len(surfaces) != 1 or not isinstance(bounds, list) or len(bounds) != 4:
            raise RuntimeError(f"No unique native bar menu geometry: {measured}, {surfaces}")
        surface = surfaces[0]
        scrollbar = bar_scrollbar()
        if scrollbar:
            vertical = surface["h"] > surface["w"]
            axis = 1 if vertical else 0
            limit = surface["h"] if vertical else surface["w"]
            if bounds[axis] < 0 or bounds[axis] + bounds[axis + 2] > limit:
                set_bar_scroll(scrollbar, 0)
                measured = measure_native(node)
                bounds = measured["window_bounds"]
                t.accessibility(
                    "scroll native bar target into viewport", "set-value",
                    "--name=" + scrollbar.get("native_name", scrollbar.get("name", "")),
                    "--role", scrollbar["role"], "--bus", str(scrollbar["bus"]),
                    "--path", str(scrollbar["path"]), "--value",
                    str(max(0, bounds[axis] - 4)),
                )
                measured = measure_native(node)
                bounds = measured["window_bounds"]
                surface = layer("shade-bar")
        if (bounds[0] < 0 or bounds[1] < 0 or bounds[2] <= 0 or bounds[3] <= 0
                or bounds[0] + bounds[2] > surface["w"]
                or bounds[1] + bounds[3] > surface["h"]):
            raise RuntimeError(f"Native menu target is outside visible bar allocation: {measured}, {surface}")
        t.vnc(label + " by measured pointer", "move",
              str(surface["x"] + bounds[0] + bounds[2] // 2),
              str(surface["y"] + bounds[1] + bounds[3] // 2), "click", "1")
        return {"target": measured, "layer": surface}

    def named(name, role=None, contains=False):
        return t.wait_until("visible " + name, lambda: t.find_accessible_node(
            name, role=role, contains=contains), timeout=12)

    def click(name, role="button", contains=False):
        t.click_accessible_node(named(name, role, contains), "review " + name)

    def quick(path=()):
        t.close_quick_settings()
        t.open_quick_settings()
        layer("shade-quicksettings")
        named("Controles rápidos", role="window")
        for control, heading in path:
            click(control, contains=(control in ("Outros controles", "Temporizador:")))
            named(heading, role="window")
        t.vnc("wait for visible quick-page allocation", "pause", "0.35")
        # Waiting for the actual header avoids capturing the previous stack page.

    def text(value):
        node = t.accessibility("find launcher search", "find", "--max-depth", "24",
                               "--max-nodes", "3000", "--name", "", "--role", "text box")
        t.accessibility("set launcher search", "set-text", "--bus", str(node["bus"]),
                        "--path", str(node["path"]), "--name=" + node.get("native_name", node.get("name", "")),
                        "--text", value)

    def setting(key, value=None):
        environment = t.gsettings_environment()
        command = shlex.join(["env", "-u", "GSETTINGS_SCHEMA_DIR", "-u", "XDG_DATA_DIRS",
                              *[f"{key}={value}" for key, value in environment.items()]])
        command += " gsettings "
        schema = "com.caioasmuniz.shade_shell.bar"
        if value is not None:
            t.desktop("set guest bar preference", command + "set " + schema + " " + key + " " + shlex.quote(value))
        return t.desktop("read guest bar preference", command + "get " + schema + " " + key).stdout.strip()

    def bars():
        saved = t.gsetting("position")
        try:
            for raw, edge in ((2, "Top"), (8, "Left"), (4, "Right"), (16, "Bottom")):
                t.gsetting("position", str(raw))
                t.wait_bar_position(edge, str(raw))
                capture("bar-" + edge.lower())
                quick()
                capture("bar-" + edge.lower() + "-quick-home")
                t.close_quick_settings()
        finally:
            t.gsetting("position", saved)

    attempt("bar-four-edges", bars)

    def dock():
        saved = {key: setting(key) for key in ("dock-enabled", "dock-pinned-apps")}
        review_app_path = None
        started = False
        try:
            setting("dock-enabled", "true")
            setting("dock-pinned-apps", "[]")
            named("No applications pinned")
            capture("dock-empty")
            def discover_apps():
                code = (
                    "import os, subprocess\n"
                    "pid = subprocess.check_output(['systemctl', '--user', 'show', "
                    "'shade-shell.service', '-p', 'MainPID', '--value'], text=True).strip()\n"
                    "exe = os.readlink('/proc/' + pid + '/exe')\n"
                    "with open('/proc/' + pid + '/environ', 'rb') as stream:\n"
                    "    env = dict(item.split(b'=', 1) for item in stream.read().split(bytes([0])) if b'=' in item)\n"
                    "env = {key.decode(): value.decode() for key, value in env.items()}\n"
                    "os.execvpe(exe, [exe, '-c', " +
                    repr("const Gio=imports.gi.Gio; print(JSON.stringify(Gio.AppInfo.get_all()"
                         ".filter(a=>a.should_show()).map(a=>({id:a.get_id(),name:a.get_display_name(),"
                         "icon:a.get_icon()?.to_string()??null}))));")
                    + "], env)\n"
                )
                return json.loads(t.desktop(
                    "discover eligible guest desktop application",
                    "python3 -c " + shlex.quote(code)
                ).stdout.strip())
            apps = discover_apps()
            if not apps:
                desktop_dir = t.desktop("read guest application data directory", "printf %s \"$HOME\"").stdout.strip() + "/.local/share/applications"
                review_app_id = "shade-ui-review-" + str(time.time_ns()) + ".desktop"
                review_app_path = desktop_dir + "/" + review_app_id
                desktop_entry = ("[Desktop Entry]\nType=Application\nName=Shade UI Review Application\n"
                                 "Exec=/usr/bin/true\nTerminal=false\nCategories=Utility;\n")
                t.desktop("create guest-only desktop app fixture and refresh application database",
                          "mkdir -p " + shlex.quote(desktop_dir) + " && printf %s "
                          + shlex.quote(desktop_entry) + " > " + shlex.quote(review_app_path)
                          + " && update-desktop-database " + shlex.quote(desktop_dir))
                apps = t.wait_until("eligible guest review desktop application",
                                    lambda: (found if (found := discover_apps()) else None), timeout=15)
                apps = [app for app in apps if app["id"] == review_app_id]
            if not apps:
                raise RuntimeError("Guest Gio application registry did not load any eligible real desktop entry")
            app = next((app for app in apps if app["id"] == "mpv.desktop"), apps[0])
            setting("dock-pinned-apps", "[" + repr(app["id"]) + "]")
            named(app["name"], contains=True)
            capture("dock-pinned", {"desktop_file_id": app["id"], "display_name": app["name"], "icon": app.get("icon")})
            t.start_pattern_window("Shade review running application " + "long title " * 25)
            started = True
            capture("dock-running", {"desktop_file_id": app["id"], "display_name": app["name"], "icon": app.get("icon")})
            node = named(app["name"], role="button", contains=True)
            measured = t.accessibility(
                "measure exact dock button in native window coordinates", "find",
                "--bus", str(node["bus"]), "--path", str(node["path"]),
                "--name=" + node.get("native_name", node["name"]), "--role", node["role"], "--window-bounds")
            bounds = measured.get("window_bounds")
            if not isinstance(bounds, list) or len(bounds) != 4 or bounds[2] <= 0 or bounds[3] <= 0:
                raise RuntimeError(f"Dock native allocation is invalid: {measured}")
            surface = layer("shade-dock")
            if (bounds[0] < 0 or bounds[1] < 0 or bounds[0] + bounds[2] > surface["w"]
                    or bounds[1] + bounds[3] > surface["h"]):
                raise RuntimeError(f"Dock native allocation does not fit mapped layer: {measured}, {surface}")
            x = surface["x"] + bounds[0] + bounds[2] // 2
            y = surface["y"] + bounds[1] + bounds[3] // 2
            if not (surface["x"] <= x < surface["x"] + surface["w"]
                    and surface["y"] <= y < surface["y"] + surface["h"]):
                raise RuntimeError(f"Dock context point lies outside its layer: {(x, y)}, {surface}")
            t.vnc("open actual dock item context menu", "move", str(x), str(y), "click", "3")
            # Capture immediately; never pick one of the duplicate global Unpin
            # nodes. The native item geometry and click context are evidence,
            # but this does not claim an Unpin action was exercised.
            capture("dock-context-menu", {
                "activated_item": measured, "dock_layer": surface,
                "pointer": [x, y], "interaction": "secondary pointer click",
                "scope": "Immediate post-click visual evidence only; Unpin was not activated because AT-SPI matches are ambiguous.",
            })
        finally:
            t.vnc("cancel dock context menu", "key", "esc")
            if started:
                t.stop_pattern_window()
            for key, value in saved.items():
                setting(key, value)
            if review_app_path:
                desktop_dir = review_app_path.rsplit("/", 1)[0]
                t.desktop("remove exact guest review desktop fixture",
                          "rm -f " + shlex.quote(review_app_path) + " && update-desktop-database "
                          + shlex.quote(desktop_dir), check=False)

    attempt("dock", dock)

    def launcher():
        t.activate_shell_action("toggle-applauncher")
        layer("shade-launcher")
        capture("launcher-apps")
        text("ShadeNoSuchApplication938471")
        named("Nenhum aplicativo encontrado", role="label")
        capture("launcher-search-empty")
        text("Long application search " * 30)
        named("Nenhum aplicativo encontrado", role="label")
        capture("launcher-long-search")

    attempt("launcher", launcher)

    def clipboard():
        original_types = t.desktop("snapshot real clipboard MIME types", "wl-paste --list-types", check=False).stdout.splitlines()
        original_type = next((mime for mime in ("image/png", "text/plain", "UTF8_STRING") if mime in original_types), None)
        saved_clipboard = "/tmp/shade-ui-review-original-clipboard"
        if original_type:
            t.desktop("save existing real clipboard payload",
                      "wl-paste --no-newline --type " + shlex.quote(original_type) + " > " + saved_clipboard)
        try:
            t.activate_shell_action("open-clipboard")
            layer("shade-launcher")
            capture("clipboard-initial")
            text("> ShadeNoSuchClipboard938471")
            named("Nenhum resultado no histórico da área de transferência", role="label")
            capture("clipboard-search-empty")
            t.activate_shell_action("close-all")
            marker = "Shade UI review clipboard " + str(time.time_ns())
            t.desktop("copy guest review text without blocking Wayland owner",
                      "systemd-run --user --collect --unit=shade-ui-review-clipboard-text sh -c "
                      + shlex.quote("printf %s " + shlex.quote(marker) + " | wl-copy --foreground"))
            t.activate_shell_action("open-clipboard")
            layer("shade-launcher")
            text("> " + marker)
            named(marker, role="label")
            capture("clipboard-text")
            t.activate_shell_action("close-all")
            t.desktop("copy real guest screenshot without blocking Wayland owner",
                      "grim /tmp/shade-ui-review-clipboard.png && "
                      "systemd-run --user --collect --unit=shade-ui-review-clipboard-image sh -c "
                      + shlex.quote("exec wl-copy --foreground --type image/png < /tmp/shade-ui-review-clipboard.png"))
            t.activate_shell_action("open-clipboard")
            layer("shade-launcher")
            text(">")
            capture("clipboard-image-actions", {"fixture": "Real guest screenshot copied through wl-copy; inspect image row and native actions"})
        finally:
            if original_type:
                t.desktop("restore original real clipboard payload asynchronously",
                          "systemd-run --user --collect --unit=shade-ui-review-clipboard-restore sh -c "
                          + shlex.quote("exec wl-copy --foreground --type " + shlex.quote(original_type)
                                        + " < " + shlex.quote(saved_clipboard)), check=False)
    attempt("clipboard", clipboard)

    def switcher():
        started = False
        settings = False
        try:
            if not t.clients():
                t.activate_shell_action("toggle-windowswitcher")
                named("Pressione Esc para fechar o seletor.")
                capture("switcher-no-client")
                t.vnc("cancel empty switcher", "key", "esc")
            else:
                unavailable("switcher-no-client", "Guest has existing clients; review does not destroy them")
            t.start_pattern_window("Shade switcher " + "Long title " * 40)
            started = True
            t.open_settings()
            settings = True
            t.close_quick_settings()
            t.activate_shell_action("toggle-windowswitcher")
            layer("shade-switcher")
            capture("switcher-many-clients-long-titles", {"client_count": len(t.clients())})
        finally:
            t.vnc("cancel switcher", "key", "esc")
            if settings:
                t.close_settings()
            if started:
                t.stop_pattern_window()

    attempt("switcher", switcher)
    routes = {
        "home": (),
        "wifi": (("Wi-Fi details", "Wi-Fi"),),
        "bluetooth": (("Bluetooth details", "Bluetooth"),),
        "output": (("Saída de áudio: opções de dispositivos", "Saída de áudio"),),
        "input": (("Microfone: opções de dispositivos", "Microfone"),),
        "mixer": (("Saída de áudio: opções de dispositivos", "Saída de áudio"), ("Mixer de aplicativos", "Mixer de aplicativos")),
        "displays": (("Opções de telas", "Telas"),),
        "other": (("Outros controles", "Outros controles"),),
        "data": (("Data e clima", "Data e clima"),),
    }
    for key, control, title in (
        ("profile", "Opções do perfil de energia", "Perfil de energia"),
        ("appearance", "Opções de tema", "Aparência"),
        ("capture", "Opções de captura", "Captura de tela"),
        ("inhibit", "Opções para evitar suspensão", "Manter ativo"),
        ("timer", "Temporizador:", "Temporizador"),
        ("nightlight", "Opções de luz noturna", "Luz noturna"),
    ):
        routes[key] = (("Outros controles", "Outros controles"), (control, title))
    for name, path in routes.items():
        attempt("quick-" + name, lambda name=name, path=path: (quick(path), capture("quick-" + name)))

    def scenario(method):
        before = len(t.review_records)
        try:
            t.review_run_scenario(method)
        except Exception as error:
            added = t.review_records[before:]
            if type(error).__name__ == "Unsupported" and added:
                added[-1]["status"] = "unavailable"
                added[-1]["reason"] = str(error)
                added[-1]["reviewed"] = False
                t.write_review_manifest()
                return
            raise
        finally:
            # Include intermediate evidence even when the real assertion fails.
            records.extend(t.review_records[before:])

    for name, method in (
        ("wifi-radio", "test_wifi"),
        ("wifi-credentials", "test_wifi_credentials"),
        ("bluetooth-pairing", "test_bluetooth_pairing"),
        ("brightness", "test_guest_brightness"),
    ):
        attempt(name, lambda method=method: scenario(method))

    def audio():
        defaults = {kind: t.desktop("snapshot audio default", "pactl get-default-" + kind).stdout.strip()
                    for kind in ("sink", "source")}
        active = t.desktop("snapshot audio fixture", "systemctl --user is-active shade-vm-audio-fixture.service", check=False).returncode == 0
        try:
            t.desktop("start real PipeWire fixture", "systemctl --user start shade-vm-audio-fixture.service")
            for kind, endpoint, route in (("sink", "shade_vm_test_output", "output"),
                                           ("source", defaults["source"], "input")):
                t.wait_until("fixture " + endpoint, lambda endpoint=endpoint, kind=kind:
                             endpoint in t.desktop("wait PipeWire endpoint", "pactl list short " + kind + "s").stdout)
                volume = t.audio_volume_raw(kind, endpoint)
                muted = t.desktop("snapshot fixture mute", f"pactl get-{kind}-mute {endpoint}").stdout.strip().endswith("yes")
                try:
                    t.desktop("select fixture endpoint", f"pactl set-default-{kind} {endpoint}")
                    quick(routes[route])
                    capture("quick-" + route + "-device")
                    t.desktop("change fixture volume", f"pactl set-{kind}-volume {endpoint} 37%")
                    capture("quick-" + route + "-volume")
                    t.close_quick_settings()
                    osd("osd-" + route + "-volume", f"pactl set-{kind}-volume {endpoint} 43%")
                    osd("osd-" + route + "-mute", f"pactl set-{kind}-mute {endpoint} 1")
                    quick(routes[route])
                    capture("quick-" + route + "-mute")
                finally:
                    t.set_audio_volume_raw(kind, endpoint, volume)
                    t.desktop("restore fixture mute", f"pactl set-{kind}-mute {endpoint} {int(muted)}", check=False)
            quick(routes["mixer"])
            capture("quick-mixer-before-stream")
            t.desktop("start real audio stream", "systemd-run --user --unit=shade-ui-review-stream --collect sh -c 'exec paplay --raw --rate=48000 --channels=2 --format=s16le --device=shade_vm_test_output /dev/zero'")
            t.wait_until("real playback stream", lambda: t.desktop("list playback streams", "pactl list short sink-inputs").stdout.strip())
            quick(routes["mixer"])
            capture("quick-mixer-streams-routing")
        finally:
            t.desktop("stop review stream", "systemctl --user stop shade-ui-review-stream.service", check=False)
            for kind, endpoint in defaults.items():
                if endpoint:
                    t.desktop("restore audio default", f"pactl set-default-{kind} " + shlex.quote(endpoint), check=False)
            if not active:
                t.desktop("stop review audio fixture", "systemctl --user stop shade-vm-audio-fixture.service", check=False)

    attempt("audio-fixture", audio)

    def notifications():
        before = t.notification_dnd()
        cleanup_failures = []
        journey_error = None

        def owned_toast_state(title):
            tree = t.accessibility_tree("probe owned notification toast " + title)
            matches = []

            def visit(node, ancestry):
                name = node.get("name", "")
                current = ancestry + ([node] if node.get("role") == "label" and name == title else [])
                if node.get("role") == "button" and name == "Fechar aviso de notificação":
                    matches.append((current, node))
                for child in node.get("children", []):
                    visit(child, current)

            visit(tree, [])
            buttons = [node for ancestry, node in matches if any(
                node.get("role") == "label" and node.get("name") == title for node in ancestry
            )]
            present = any(node.get("role") == "label" and node.get("name") == title
                          for node in t.walk_accessibility(tree))
            return present, buttons

        def dismiss_owned_toast(title):
            present, buttons = owned_toast_state(title)
            if not present:
                raise RuntimeError(f"Owned notification toast {title!r} disappeared before its explicit dismissal")
            if len(buttons) != 1:
                raise RuntimeError(f"Owned visible toast {title!r} has {len(buttons)} exact native close buttons under its title ancestry; expected one")
            t.click_accessible_node(buttons[0], "dismiss exact guest review toast " + title)
            if not t.wait_until("owned toast removed after native dismissal",
                                lambda: not owned_toast_state(title)[0], timeout=3, interval=0.1):
                raise RuntimeError(f"Native close action did not remove owned notification toast {title!r}")
            capture("notification-toast-dismissed-" + title.replace("Shade ", "").replace(" ", "-"), {
                "dismissed_title": title,
                "interaction": "exact native Fechar aviso de notificação under matching title/card ancestry",
                "removal_confirmed": True,
            })

        def send_toast(title, urgency="normal", hint=""):
            t.desktop("send guest review notification", "notify-send --expire-time=60000 --app-name=ShadeUIReview --urgency=" + urgency + " " + hint + " " + shlex.quote(title) + " " + shlex.quote("Long notification body " * 35))
            layer("shade-notifications")
            named(title, role="label")
            capture("notification-toast-" + title.replace("Shade review ", "").replace(" ", "-"))
            dismiss_owned_toast(title)

        def restore_surfaces():
            try:
                t.activate_shell_action("close-all")
            except Exception as error:
                cleanup_failures.append(("close surfaces", error))
            try:
                t.notification_dnd(before)
            except Exception as error:
                cleanup_failures.append(("restore DND", error))

        try:
            t.notification_dnd(False)
            t.activate_shell_action("open-notifications")
            layer("shade-notification-center")
            capture("notification-center-initial")
            tree = t.accessibility_tree("inspect initial notification center")
            nodes = list(t.walk_accessibility(tree))
            empty = any(node.get("role") == "label" and node.get("name") == "Sem notificações"
                        for node in nodes)
            if not empty:
                dismiss = [node for node in nodes
                           if node.get("role") == "button" and node.get("name") == "Dispensar todas"]
                if len(dismiss) != 1:
                    raise RuntimeError(f"Expected one native Dismiss all control for active guest notifications: {dismiss}")
                t.click_accessible_node(dismiss[0], "dismiss active guest notifications")
            named("Sem notificações", role="label")
            capture("notification-center-empty")
            t.activate_shell_action("close-all")
            send_toast("Shade review normal")
            send_toast("Shade review progress", hint="--hint=int:value:42")
            send_toast("Shade review image", hint="--icon=/tmp/shade-ui-review-clipboard.png")
            t.desktop("send guest review critical notification", "notify-send --expire-time=0 --app-name=ShadeUIReview --urgency=critical 'Shade review critical' 'Long notification body'")
            critical_layer = layer("shade-notifications")
            named("Shade review critical", role="label")
            capture("notification-toast-critical")
            t.activate_shell_action("open-notifications")
            layer("shade-notification-center")
            named("Shade review critical", role="label")
            capture("notification-center-critical-active")
            suppressed = t.wait_until(
                "critical toast layer suppressed while center mapped",
                lambda: (
                    next((item for item in t.layers() if item.get("namespace") == "shade-notification-center"), None)
                    and not any(item.get("namespace") == "shade-notifications" for item in t.layers())
                ),
                timeout=5, interval=0.1,
            )
            if not suppressed:
                raise RuntimeError("Critical toast compositor layer remained mapped while notification center was mapped")
            capture("notification-center-critical-toast-layer-suppressed", {
                "critical_title": "Shade review critical",
                "critical_toast_layer_absent_while_center_mapped": True,
                "previous_toast_layer": critical_layer,
            })
            t.activate_shell_action("close-all")
            remapped = t.wait_until("critical toast layer remapped after center closes",
                                    lambda: next((item for item in t.layers() if item.get("namespace") == "shade-notifications"), None),
                                    timeout=5, interval=0.1)
            named("Shade review critical", role="label")
            capture("notification-toast-critical-remapped", {"layer": remapped, "title_visible": True})
            dismiss_owned_toast("Shade review critical")

            t.desktop("send notification with actual action", "systemd-run --user --unit=shade-ui-review-notification --collect notify-send --wait --expire-time=0 --action=review=Review --app-name=ShadeUIReview 'Shade actionable review' 'Long actionable content'")
            layer("shade-notifications")
            named("Shade actionable review", role="label")
            t.activate_shell_action("open-notifications")
            layer("shade-notification-center")
            named("Shade actionable review", role="label")
            capture("notification-center-active-actions-long")
            click("Histórico")
            named("Limpar histórico", role="button")
            capture("notification-history-populated")
            click("Limpar histórico")
            capture("notification-history-clear-confirm")
            t.vnc("cancel clearing notification history", "key", "esc")
            t.activate_shell_action("close-all")
            dismiss_owned_toast("Shade actionable review")
        except Exception as error:
            journey_error = error
        finally:
            restore_surfaces()
            try:
                t.desktop("stop guest notification sender", "systemctl --user stop shade-ui-review-notification.service", check=False)
            except Exception as error:
                cleanup_failures.append(("stop notification sender", error))
            # If a fixture toast is still mapped, use only its uniquely-owned card control.
            for title in ("Shade actionable review", "Shade review critical", "Shade review image",
                          "Shade review progress", "Shade review normal"):
                try:
                    if any(item.get("namespace") == "shade-notification-center" for item in t.layers()):
                        t.activate_shell_action("close-all")
                    if any(item.get("namespace") == "shade-notifications" for item in t.layers()):
                        present, buttons = owned_toast_state(title)
                        if present:
                            dismiss_owned_toast(title)
                except Exception as error:
                    cleanup_failures.append((title, error))
            restore_surfaces()
        if journey_error:
            if cleanup_failures:
                journey_error.add_note("Notification cleanup failures: " + repr([(title, repr(error)) for title, error in cleanup_failures]))
            raise journey_error
        if cleanup_failures:
            raise RuntimeError("Notification cleanup failures: " + repr([(title, repr(error)) for title, error in cleanup_failures]))
    attempt("notifications", notifications)

    def clock():
        timer_started = False
        try:
            button = named("Horário ", role="button", contains=True)
            opened = open_native_menu(button, "open native clock popover")
            named("Relógio mundial", role="label")
            capture("clock-popover", {
                "target": opened["target"], "bar_layer": opened["layer"],
                "interaction": "measured pointer click on Gtk.MenuButton",
            })
            capture("clock-world-clocks")
            named("Temporizador", role="label")
            capture("clock-timer-presets")
            running = any(
                item.get("name") == "Parar" and item.get("role") == "button"
                for item in t.walk_accessibility(t.accessibility_tree("reading current clock timer"))
            )
            if running:
                capture("clock-timer-running-existing")
                unavailable("clock-timer-presets-running-pomodoro", "A real timer was already running; preserving its state rather than replacing it.")
            else:
                click("5m")
                timer_started = True
                named("Parar", role="button")
                capture("clock-timer-running")
                click("Pomodoro", role="toggle button")
                capture("clock-pomodoro-presets")
                click("Temporizador", role="toggle button")
        finally:
            if timer_started:
                click("Parar", role="button")

    attempt("clock-popover", clock)

    def weather():
        button = named("°", role="button", contains=True)
        opened = open_native_menu(button, "open native weather popover")
        named("Atualizar clima", role="button")
        capture("weather-popover", {
            "target": opened["target"], "bar_layer": opened["layer"],
            "control": "Atualizar clima", "interaction": "measured pointer click",
            "scope": "Popover inspected without activating refresh.",
        })

    attempt("weather-popover", weather)

    def keyboard_layout():
        option = json.loads(t.desktop(
            "snapshot guest keyboard layout configuration", "hyprctl getoption input:kb_layout -j"
        ).stdout)
        original = option.get("str")
        if not isinstance(original, str):
            raise RuntimeError(f"Guest keyboard layout setting is not restorable: {option}")
        try:
            t.desktop("configure temporary guest-only alternate keyboard layouts",
                      "hyprctl eval 'hl.config({input = {kb_layout = \"us,br\"}})'")

            def current_keyboard():
                devices = json.loads(t.desktop(
                    "read actual guest keyboard layout", "hyprctl devices -j"
                ).stdout)
                keyboards = [device for device in devices.get("keyboards", [])
                             if device.get("name") not in ("wlroots-keyboard-pointer", "wayland", "")]
                if not keyboards:
                    raise RuntimeError(f"Guest has no real keyboard device: {devices}")
                return keyboards[0]

            initial_keyboard = t.wait_until(
                "one configured alternate keyboard layout active",
                lambda: (keyboard if (keyboard := current_keyboard())
                         and ("US" in keyboard.get("active_keymap", "").upper()
                              or "BR" in keyboard.get("active_keymap", "").upper()) else None),
                timeout=12,
            )
            keyboard_name = initial_keyboard["name"]
            initial = initial_keyboard["active_keymap"]
            initial_code = "US" if "US" in initial.upper() else "BR"
            alternate_code = "BR" if initial_code == "US" else "US"
            scrollbar = bar_scrollbar()
            adjustment = None
            if scrollbar:
                script = """
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("accessibility", "/tmp/shade-workflow-accessibility.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
atspi = module.Atspi(module.bus_address())
values = {}
for key, prop in (("minimum", "MinimumValue"), ("maximum", "MaximumValue"), ("current", "CurrentValue")):
    reply = atspi.call(sys.argv[1], sys.argv[2], "org.freedesktop.DBus.Properties", "Get",
                       "org.a11y.atspi.Value", prop, signature="ss")
    if len(reply) != 3 or reply[:2] != ["v", "d"]:
        raise RuntimeError("Invalid native adjustment reply: " + repr(reply))
    values[key] = float(reply[2])
print(json.dumps(values))
"""
                adjustment = json.loads(t.desktop(
                    "read native bar long-axis adjustment",
                    shlex.join(["python3", "-c", script, str(scrollbar["bus"]), str(scrollbar["path"])]),
                    timeout=45,
                ).stdout)
                if (not isinstance(adjustment, dict)
                        or any(not isinstance(adjustment.get(key), (int, float))
                               or not math.isfinite(adjustment[key])
                               for key in ("minimum", "maximum", "current"))
                        or not adjustment["minimum"] <= adjustment["current"] <= adjustment["maximum"]):
                    raise RuntimeError(f"Invalid native bar adjustment: {adjustment!r}")
            overflow = bool(adjustment and adjustment["maximum"] > adjustment["minimum"])
            if overflow:
                top = set_bar_scroll(scrollbar, 0)
                bottom = set_bar_scroll(scrollbar, 1)
                if bottom["actual"] <= top["actual"]:
                    raise RuntimeError(f"Bar scrollbar did not move to its measured end: {top}, {bottom}")
            button = named(initial_code, role="button", contains=True)
            measured = measure_native(button)
            bounds = measured.get("window_bounds")
            words = measured.get("state_words", [])
            bar_surface = layer("shade-bar")
            if (not isinstance(bounds, list) or len(bounds) != 4
                    or not words or not int(words[0]) & (1 << 25)
                    or bounds[0] < 0 or bounds[1] < 0 or bounds[2] <= 0 or bounds[3] <= 0
                    or bounds[0] + bounds[2] > bar_surface["w"]
                    or bounds[1] + bounds[3] > bar_surface["h"]):
                raise RuntimeError(f"Keyboard control is not natively showing inside the bar: {measured}, {bar_surface}")
            if overflow:
                capture("bar-long-axis-scroll-end", {
                    "scrollbar": scrollbar, "top_value": top["actual"],
                    "end_value": bottom["actual"], "target": measured,
                    "bar_layer": bar_surface,
                })
            capture("keyboard-layout-" + initial_code.lower(), {
                "active_keymap": initial, "accessible_control": button,
                "keyboard_name": keyboard_name, "keyboard_is_main": initial_keyboard.get("main"),
                "configured_guest_layouts": "us,br",
            })
            t.click_accessible_node(button, "cycle actual guest keyboard layout")

            def alternate():
                keyboard = current_keyboard()
                if keyboard.get("name") != keyboard_name:
                    raise RuntimeError(f"Selected keyboard changed during review: {keyboard_name!r}, {keyboard!r}")
                keymap = keyboard.get("active_keymap", "")
                return keymap if alternate_code in keymap.upper() else None

            changed = t.wait_until("real alternate keyboard layout transition", alternate, timeout=12)
            button = named(alternate_code, role="button", contains=True)
            capture("keyboard-layout-" + alternate_code.lower(), {
                "active_keymap": changed, "accessible_control": button,
                "keyboard_name": keyboard_name, "keyboard_is_main": initial_keyboard.get("main"),
                "interaction": "native KeyboardLayout.cycle via actual bar button",
                "osd": "The indicator updates its bar label; no OSD is implemented.",
            })
        finally:
            try:
                if "overflow" in locals() and overflow:
                    restored = t.accessibility(
                        "restore native bar long-axis adjustment", "set-value",
                        "--name=" + scrollbar.get("native_name", scrollbar.get("name", "")),
                        "--role", scrollbar["role"], "--bus", str(scrollbar["bus"]),
                        "--path", str(scrollbar["path"]), "--value", str(adjustment["current"]),
                    )
                    if not math.isclose(restored["actual"], adjustment["current"], abs_tol=0.01):
                        raise RuntimeError(f"Bar adjustment was not restored: {adjustment}, {restored}")
            finally:
                t.desktop("restore original guest keyboard layout configuration",
                          "hyprctl eval " + shlex.quote(
                              "hl.config({input = {kb_layout = " + json.dumps(original, ensure_ascii=False) + "}})"
                          ))

    attempt("keyboard-layout", keyboard_layout)

    # Real MPRIS/SNI providers are exercised by vm_ui_review_provider_apps.
    from vm_ui_review_provider_apps import run_review as review_provider_apps
    records.extend(review_provider_apps(t, theme, viewport))
    for name, reason in (
        ("touchpad", "Guest has no touchpad input device; disabled control state is captured, not physical input behavior."),
        ("battery", "Guest has no UPower battery device; no physical battery claim is made."),
    ):
        unavailable(name, reason)
    return records
