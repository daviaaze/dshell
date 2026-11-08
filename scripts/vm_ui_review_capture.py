"""Real guest capture and portal UI review journeys (no host interactions)."""

import json
import shlex
import time
from pathlib import Path


def run_review(t, theme: str, viewport: str) -> list[dict]:
    records = []
    saved = {key: t.gsetting(key) for key in (
        "recorder-backend", "record-audio", "show-recording-boundary", "area-selection-engine",
    )}
    dnd = t.notification_dnd()
    pattern = None
    portal_open = False

    def capture(screen, notes=None):
        if screen.startswith("share-"):
            clients = t.clients()
            source = next((client for client in clients
                           if pattern is not None and client.get("address") == pattern["address"]
                           and client.get("class") == "org.shade.WorkflowPattern"
                           and client.get("mapped")), None)
            if pattern is not None and source is None:
                raise RuntimeError("The real window source is no longer mapped")
            pickers = [client for client in clients
                       if client.get("mapped") and client.get("title") == "Escolha o que compartilhar"]
            if len(pickers) > 1 or (portal_open and not pickers):
                raise RuntimeError(f"Missing or ambiguous portal window for visual review: {pickers!r}")
            if pickers:
                picker = pickers[0]
                if source:
                    def rect(client):
                        at, size = client.get("at"), client.get("size")
                        if (not isinstance(at, list) or len(at) != 2
                                or not isinstance(size, list) or len(size) != 2
                                or not all(isinstance(n, (int, float)) for n in at + size)
                                or min(size) <= 0):
                            raise RuntimeError(f"Invalid compositor window geometry: {client!r}")
                        return (*at, *size)

                    px, py, pw, ph = rect(picker)
                    _, _, rw, rh = rect(source)
                    candidates = []
                    for monitor in t.monitors():
                        scale = float(monitor.get("scale", 1))
                        if scale <= 0:
                            raise RuntimeError(f"Invalid monitor scale: {monitor!r}")
                        mx, my = monitor["x"], monitor["y"]
                        mw, mh = monitor["width"] / scale, monitor["height"] / scale
                        # The fixed-size fixture may extend past the output, but
                        # at least a 64×64 logical region must remain visible.
                        for x, y in ((px - rw - 8, my), (px + pw + 8, my),
                                     (mx, py - rh - 8), (mx, py + ph + 8)):
                            x, y = int(x), int(y)
                            iw = max(0, min(x + rw, mx + mw) - max(x, mx))
                            ih = max(0, min(y + rh, my + mh) - max(y, my))
                            if iw >= 64 and ih >= 64:
                                candidates.append((iw * ih, x, y))
                    if not candidates:
                        raise RuntimeError(f"No useful visible source position outside picker: source={source!r}, picker={picker!r}")
                    _, x, y = max(candidates)
                    t.desktop(
                        "move the real window source to a visible region outside the chooser",
                        "hyprctl dispatch " + shlex.quote(
                            f'hl.dsp.window.move({{x = {x}, y = {y}, window = "address:{source["address"]}"}})'
                        ),
                    )
                    # The chooser snapshots its sources per request. Inspect the
                    # actual window tab, then restore the precise review state.
                    review_kind = ("window" if screen == "share-window-before-source-gone"
                                   else screen.split("-")[1] if screen.endswith("-review") else None)
                    if review_kind:
                        click("Escolher outra fonte")
                    click("Janelas", "tab")
                    matching = [c for c in t.clients() if c.get("mapped")
                                and c.get("class") == source["class"]]
                    if len(matching) != 1 or matching[0].get("address") != source["address"]:
                        raise RuntimeError(f"Cannot uniquely identify the portal window source: {matching!r}")
                    source_node = t.find_accessible_node(source["class"], role="button", contains=True)
                    if review_kind:
                        if review_kind == "window":
                            t.click_accessible_node(source_node, "restoring the reviewed window source")
                            wait_label("Revise a janela escolhida")
                        else:
                            choose_source("screen")
                    else:
                        tab = ("Telas" if screen.endswith("-screens-tab") else
                               "Todas as fontes" if screen.endswith("-combined-tab") else
                               "Janelas" if screen.endswith("-windows-tab") else
                               "Telas" if screen.startswith("share-screen-") else "Janelas")
                        click(tab, "tab")
                t.desktop(
                    "focus the actual picker for visual review",
                    "hyprctl dispatch " + shlex.quote(
                        'hl.dsp.focus({window = "address:' + picker["address"] + '"})'
                    ),
                )
                t.wait_until(
                    "portal is the compositor-confirmed active window",
                    lambda: t.active_window().get("address") == picker["address"],
                    timeout=8,
                )
                if source:
                    def separated():
                        current = {client.get("address"): client for client in t.clients()}
                        real = current.get(source["address"])
                        chooser = current.get(picker["address"])
                        if (not real or not chooser or not real.get("mapped") or not chooser.get("mapped")
                                or real.get("class") != "org.shade.WorkflowPattern"
                                or real.get("monitor", -1) < 0):
                            return None
                        if any(not isinstance(client.get(key), list) or len(client[key]) != 2
                               for client in (real, chooser) for key in ("at", "size")):
                            return None
                        rx, ry, rw, rh = rect(real)
                        px, py, pw, ph = rect(chooser)
                        if not (rx + rw <= px or px + pw <= rx or ry + rh <= py or py + ph <= ry):
                            return None
                        visible = []
                        for monitor in t.monitors():
                            scale = float(monitor.get("scale", 1))
                            if scale <= 0:
                                continue
                            mx, my = monitor.get("x", 0), monitor.get("y", 0)
                            mw = monitor.get("width", 0) / scale
                            mh = monitor.get("height", 0) / scale
                            iw = max(0, min(rx + rw, mx + mw) - max(rx, mx))
                            ih = max(0, min(ry + rh, my + mh) - max(ry, my))
                            if iw >= 64 and ih >= 64:
                                visible.append({"monitor": monitor.get("name"), "intersection": [iw, ih]})
                        if not visible:
                            return None
                        return {"source": real, "picker": chooser, "visible_monitor_intersections": visible}

                    geometry = t.wait_until(
                        "mapped, eligible window source outside compositor-confirmed picker geometry",
                        separated, timeout=8,
                    )
                    notes = {"separated_windows": geometry, "context": notes}
                else:
                    notes = {"focused_picker": picker["address"], "context": notes}
        record = t.review_capture(screen, notes=notes)
        records.append(record)
        return record

    def unavailable(screen, reason):
        records.append(t.review_unavailable(screen, reason))

    def click(name, role="button"):
        t.click_named("UI review: " + name, name, role=role)

    def wait_label(name):
        return t.wait_until(name, lambda: t.find_accessible_node(name, role="label"), timeout=15)

    def overlay_visible():
        return any(layer.get("namespace") == "shade-screenshot" for layer in t.layers())

    def fresh_pattern():
        return t.wait_until(
            "current mapped pattern geometry",
            lambda: next((c for c in t.clients() if c.get("address") == pattern.get("address")
                          and c.get("mapped", True)), None), timeout=12,
        )

    def accessible_branch(tree, path):
        chain = []
        def find(node):
            if node.get("path") == path:
                chain.append(node)
                return True
            for child in node.get("children", []):
                if isinstance(child, dict) and find(child):
                    chain.append(node)
                    return True
            return False
        find(tree)
        return chain

    def select_window_fixture():
        client = fresh_pattern()
        label = t.find_accessible_node("Capturar tela", role="label")
        tree = t.accessibility_tree("finding screenshot selector native panel")
        chain = accessible_branch(tree, label["path"])
        layer = next((item for item in t.layers() if item.get("namespace") == "shade-screenshot"), None)
        if layer is None:
            raise RuntimeError("Screenshot selector compositor layer is unavailable")
        candidates = []
        for node in chain:
            bounds = node.get("bounds")
            if (node.get("role") not in ("window", "application", "desktop frame")
                    and node.get("bus") == label["bus"]
                    and isinstance(bounds, list) and len(bounds) == 4
                    and 0 < bounds[2] < int(layer["w"])
                    and 0 < bounds[3] < int(layer["h"])):
                candidates.append(node)
        valid_panels = [node for node in candidates
                        if {"revisar alvo", "cancelar"} <= {
                            str(child.get("name") or "").casefold()
                            for child in t.walk_accessibility(node)
                        }]
        if not valid_panels:
            raise RuntimeError(f"No measurable non-window screenshot panel ancestor containing Revisar alvo and Cancelar: {chain}")
        # The largest qualifying ancestor retains Clamp/card padding; smaller
        # VBox/Stack descendants do not represent the actual panel surface.
        panel = max(valid_panels, key=lambda node: int(node["bounds"][2]) * int(node["bounds"][3]))
        native = t.accessibility(
            "measuring screenshot selector panel in native window coordinates", "find",
            "--name", str(panel.get("native_name", panel.get("name"))),
            "--role", str(panel["role"]), "--bus", str(panel["bus"]),
            "--path", str(panel["path"]), "--window-bounds",
        ).get("window_bounds")
        if (not isinstance(native, list) or len(native) != 4 or native[2] <= 0 or native[3] <= 0):
            raise RuntimeError(f"Cannot measure screenshot selector panel: {native}, {panel}")
        px, py = int(layer["x"]) + int(native[0]), int(layer["y"]) + int(native[1])
        pw, ph = int(native[2]), int(native[3])
        lx, ly, lw, lh = px, py, pw, ph
        cx0, cy0, cw, ch = map(int, (*client["at"], *client["size"]))
        cx1, cy1 = cx0 + cw, cy0 + ch
        candidates = [
            (cx0 + 20, cy0 + 30), (cx1 - 20, cy0 + 30),
            (cx0 + 20, cy1 - 20), (cx1 - 20, cy1 - 20),
        ]
        point = next(((x, y) for x, y in candidates
                      if cx0 < x < cx1 and cy0 < y < cy1
                      and int(layer["x"]) <= x < int(layer["x"]) + int(layer["w"])
                      and int(layer["y"]) <= y < int(layer["y"]) + int(layer["h"])
                      and not (lx <= x < lx + lw and ly <= y < ly + lh)), None)
        if point is None:
            raise RuntimeError(f"No visible fixture point outside measured selector panel: client={client}, panel={panel}, native={native}, layer={layer}")
        t.vnc("selecting live pattern window outside selector panel", "move", str(point[0]), str(point[1]), "click", "1")

    def activate_toggle(name):
        node = t.find_accessible_node(name, role="toggle button")
        state = t.accessibility("reading capture toggle state", "find", "--name", name,
                                "--role", "toggle button", "--bus", str(node["bus"]),
                                "--path", str(node["path"]), "--include-state")
        if not state["state_words"][0] & ((1 << 4) | (1 << 20)):
            t.click_accessible_node(node, "selecting explicit capture toggle")

    def open_capture(mode, target):
        t.desktop("opening real capture selector", "shade-shell screenshot-overlay")
        t.wait_until("capture selector", overlay_visible, timeout=15)
        activate_toggle(mode)
        activate_toggle(target)

    def select(target, edge=False):
        if target == "Área":
            if edge:
                monitors = t.monitors()
                monitor = next((m for m in monitors if m.get("focused")), monitors[0])
                # Logical output edges; the host display is never selected.
                x = int(monitor.get("x", 0))
                y = int(monitor.get("y", 0))
                scale = float(monitor.get("scale", 1))
                w = int(int(monitor["width"]) / scale)
                h = int(int(monitor["height"]) / scale)
                box = (x + 1, y + h - 100, x + w - 2, y + h - 2)
            else:
                client = fresh_pattern()
                x, y = client["at"]
                w, h = client["size"]
                box = (x + 20, y + h - 140, x + min(w - 20, 340), y + h - 20)
            t.vnc("dragging real guest capture rectangle", "move", str(box[0]), str(box[1]),
                  "mousedown", "1", "move", str(box[2]), str(box[3]), "mouseup", "1")
        elif target == "Janela":
            select_window_fixture()

    def review(mode, target, suffix, edge=False):
        open_capture(mode, target)
        capture(suffix + "-selection", {"target": target, "theme": theme, "viewport": viewport})
        select(target, edge)
        t.vnc("reviewing selected capture without consent", "key", "enter")
        action = "Capturar imagem" if mode == "Imagem" else "Iniciar gravação"
        node = t.wait_until("explicit capture confirmation", lambda: t.find_accessible_node(action, role="button"), timeout=12)
        if t.recording_processes():
            raise RuntimeError("Selection/review started recording before explicit consent")
        capture(suffix + "-review")
        return node

    def dismiss_feedback():
        click("Concluir")

    def save_result(screen, since, kind):
        wait_label("Captura concluída" if kind == "image" else "Gravação concluída")
        record = capture(screen)
        script = ("import pathlib,json,sys; root=pathlib.Path.home()/sys.argv[1]; "
                  "files=sorted((p for p in root.glob(sys.argv[2]) if p.stat().st_mtime >= float(sys.argv[3])), "
                  "key=lambda p:p.stat().st_mtime); print(json.dumps([str(p) for p in files]))")
        folder, glob = ("Pictures/Screenshots", "*.png") if kind == "image" else ("Videos", "*")
        paths = t.wait_until("real capture output file", lambda: json.loads(t.desktop(
            "locating actual capture output", "python3 -c " + shlex.quote(script) + " " +
            " ".join(map(shlex.quote, (folder, glob, since)))).stdout), timeout=15)
        source = paths[-1]
        destination = t.artifacts / (screen + Path(source).suffix)
        t.copy_guest_file(source, destination)
        record["capture_file"] = str(destination)
        record["guest_capture_file"] = source
        dismiss_feedback()

    def start_portal():
        nonlocal portal_open
        marker = t.desktop("marking portal review request", "date +%s.%N").stdout.strip()
        t.desktop("starting actual guest portal requester", "systemctl --user stop shade-vm-portal-fixture.target; systemctl --user start shade-vm-portal-fixture.target")
        portal_open = True
        picker = t.wait_until("real portal picker", lambda: next((c for c in t.clients()
            if c.get("title") == "Escolha o que compartilhar"), None), timeout=20)
        return marker, picker

    def close_portal():
        nonlocal portal_open
        t.desktop("stopping guest portal requester fixture", "systemctl --user stop shade-vm-portal-fixture.target", check=False)
        t.wait_until("portal picker cleanup", lambda: not any(c.get("title") == "Escolha o que compartilhar" for c in t.clients()), timeout=15)
        portal_open = False

    def choose_source(kind):
        click("Telas" if kind == "screen" else "Janelas", "tab")
        fragment = str(t.monitors()[0]["name"]) if kind == "screen" else "org.shade.WorkflowPattern"
        node = t.find_accessible_node(fragment, role="button", contains=True)
        t.click_accessible_node(node, "reviewing actual portal source")
        wait_label("Revise a tela escolhida" if kind == "screen" else "Revise a janela escolhida")

    def await_response(marker, success):
        def response():
            logs = t.portal_journal(marker)
            expected = "ScreenCast.Start code=0" if success else "code=1"
            return logs if expected in logs and ("Session.Close" in logs or "portal session closed" in logs) else None
        logs = t.wait_until("portal response and session closure", response, timeout=30)
        return {"portal_response_and_close": logs}

    try:
        t.notification_dnd(True)
        t.gsetting("recorder-backend", "1")
        t.gsetting("area-selection-engine", "'overlay'")
        pattern = t.start_pattern_window(title="Shade UI review — " + "long guest window title • " * 12)
        for target in ("Tela cheia", "Área", "Janela", "Monitor"):
            screen = "screenshot-" + target.lower()
            node = review("Imagem", target, screen)
            click("Alterar alvo")
            capture(screen + "-back")
            t.vnc("reviewing target again", "key", "enter")
            click("Cancelar")
            node = review("Imagem", target, screen + "-confirmed")
            since = t.desktop("marking screenshot time", "date +%s.%N").stdout.strip()
            t.click_accessible_node(node, "explicitly confirming guest screenshot")
            t.wait_until("screenshot selector closure", lambda: not overlay_visible(), timeout=15)
            save_result(screen + "-result", since, "image")

        open_capture("Imagem", "Área")
        t.vnc("trying review without area selection", "key", "enter")
        capture("screenshot-area-no-selection")
        try:
            empty_review = t.find_accessible_node("Revisar captura", role="label")
        except Exception:
            empty_review = None
        if empty_review is not None:
            raise RuntimeError("Empty area unexpectedly entered review")
        monitor = t.monitors()[0]
        y = max(20, int(int(monitor["height"]) / float(monitor.get("scale", 1))) - 25)
        t.vnc("selecting invalid tiny rectangle", "move", "25", str(y), "mousedown", "1", "move", "26", str(y + 1), "mouseup", "1", "key", "enter")
        capture("screenshot-area-small-selection")
        t.vnc("cancelling invalid capture", "key", "esc")

        # Functional audio/boundary cross-product remains in the full workflow
        # suite. Each review cell needs representative native states, not 16 videos.
        for index, target in enumerate(("Tela cheia", "Área", "Janela", "Monitor")):
            audio, boundary = ((False, False), (True, True), (True, False), (False, True))[index]
            t.gsetting("record-audio", str(audio).lower())
            t.gsetting("show-recording-boundary", str(boundary).lower())
            screen = f"record-{target.lower()}-audio-{int(audio)}-boundary-{int(boundary)}"
            node = review("Gravação", target, screen, edge=target == "Área" and boundary)
            since = t.desktop("marking recording time", "date +%s.%N").stdout.strip()
            t.click_accessible_node(node, "explicitly starting local guest recording")
            recorder = t.wait_until("supported real recorder", lambda: next(iter(t.recording_processes()), None), timeout=20)
            time.sleep(1.5)
            capture(screen + "-active", {"recorder": recorder, "edge_rectangle": target == "Área" and boundary})
            t.stop_recording()
            save_result(screen + "-result", since, "video")

        # Existing guest directory, no files moved/deleted: make only new writes
        # fail and restore its exact mode before any following capture operation.
        directory = "$HOME/Pictures/Screenshots"
        original_mode = t.desktop("reading guest screenshot directory mode",
                                  f'stat -c %a "{directory}"').stdout.strip()
        try:
            t.desktop("denying new guest screenshot writes", f'chmod a-w "{directory}"')
            node = review("Imagem", "Tela cheia", "capture-write-failure")
            t.click_accessible_node(node, "confirming real unwritable output capture")
            wait_label("Falha na captura/gravação")
            capture("capture-error", {"prerequisite": "Guest screenshot directory temporarily has no write permission."})
            click("Fechar")
        finally:
            t.desktop("restoring guest screenshot directory mode",
                      f'chmod {shlex.quote(original_mode)} "{directory}"')
        if overlay_visible():
            t.vnc("finish the retryable local capture before the independent portal review", "key", "esc")
            t.wait_until("local capture overlay dismissed before portal", lambda: not overlay_visible(), timeout=10)

        for kind in ("screen", "window"):
            marker, _ = start_portal()
            for tab, screen in (("Telas", "screens"), ("Janelas", "windows"), ("Todas as fontes", "combined")):
                click(tab, "tab")
                capture(f"share-{kind}-{screen}-tab")
            choose_source(kind)
            capture("share-" + kind + "-review")
            click("Voltar")
            capture("share-" + kind + "-back")
            choose_source(kind)
            click("Escolher outra fonte")
            capture("share-" + kind + "-change-source")
            choose_source(kind)
            click("Compartilhar")
            records.append(t.review_record("share-" + kind + "-confirm", "verified", reviewed=False, **await_response(marker, True)))
            close_portal()

        marker, _ = start_portal()
        choose_source("window")
        capture("share-window-before-source-gone")
        t.stop_pattern_window()
        pattern = None
        click("Compartilhar")
        wait_label("A fonte não está mais disponível. Escolha outra fonte ou cancele.")
        capture("share-window-source-gone")
        click("Cancelar")
        records.append(t.review_record("share-cancel", "verified", reviewed=False, **await_response(marker, False)))
        close_portal()

        # The source list is snapshotted per portal request. Only our pattern
        # fixture was closed above; do not close unrelated guest applications.
        marker, _ = start_portal()
        click("Janelas", "tab")
        other_clients = [c for c in t.clients() if c.get("mapped", True)
                         and c.get("title") != "Escolha o que compartilhar"]
        if not other_clients:
            wait_label("No windows available")
            capture("share-empty-windows")
            click("Todas as fontes", "tab")
            capture("share-empty-windows-combined")
        else:
            unavailable("share-empty-windows",
                        "Own pattern fixture is closed, but other mapped guest clients remain: " +
                        json.dumps([{"class": c.get("class"), "title": c.get("title")} for c in other_clients]))
        click("Cancelar")
        records.append(t.review_record("share-empty-request-cancel", "verified", reviewed=False, **await_response(marker, False)))
        close_portal()

        marker, picker = start_portal()
        capture("share-before-picker-close")
        t.desktop("closing only the guest picker window", "hyprctl dispatch " + shlex.quote(
            'hl.dsp.window.close({window = "address:' + picker["address"] + '"})'
        ))
        records.append(t.review_record("share-picker-window-close", "verified", reviewed=False, **await_response(marker, False)))
        close_portal()
        _, _ = start_portal()
        capture("share-before-requester-close")
        close_portal()
        capture("share-requester-gone-cleanup")

        for screen, reason in (
            ("capture-busy", "Preparation is transient; this journey does not delay the native backend to manufacture a busy state."),
            ("capture-long-path", "Native result paths are recorded in screenshot/recording result evidence; service output directories are fixed and no supported per-request long-path fixture exists."),
            ("share-preview-unavailable", "No controlled real preview-failure prerequisite is available; normal preview evidence is captured in every source tab."),
            ("share-submit-error", "No controlled real select() failure prerequisite exists; requester closure is exercised separately and is not treated as submission error."),
            ("share-loading", "Native initial preview loading is transient and no controlled delay prerequisite is available."),
        ):
            unavailable(screen, reason)
        return records
    except Exception:
        capture("capture-share-unexpected-failure", {"failure": "Actual UI at failure before cleanup; original exception follows."})
        raise
    finally:
        try:
            if t.recording_processes():
                t.stop_recording()
            if overlay_visible():
                t.vnc("cancelling remaining guest capture selector", "key", "esc")
            if portal_open:
                close_portal()
        finally:
            try:
                if pattern is not None:
                    t.stop_pattern_window()
            finally:
                try:
                    for key, value in saved.items():
                        t.gsetting(key, value)
                finally:
                    t.notification_dnd(dnd)
