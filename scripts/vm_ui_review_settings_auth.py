"""Settings, native dialog, lockscreen and greeter review journeys for the VM audit."""

from __future__ import annotations

import json
import math
import shlex
import uuid
from typing import Any

SETTINGS_DESTINATIONS = (
    "Aparência", "Barra e dock", "Telas", "Som", "Mouse e touchpad",
    "Conexões", "Bluetooth", "Bloqueio e energia", "Energia", "Notificações",
    "Não perturbe", "Captura de tela", "Compartilhamento de tela",
    "Aplicativos padrão", "Aplicativos ao entrar", "Relógio", "Clima",
    "Temporizador", "Atalhos", "Sobre o sistema", "Diagnóstico",
)

SETTINGS_SECTIONS = (
    "Aparência", "Barra e dock", "Telas", "Som", "Mouse e touchpad", "Conexões",
    "Bloqueio e energia", "Notificações", "Captura e compartilhamento", "Aplicativos",
    "Tempo e concentração", "Atalhos", "Sistema e diagnóstico",
)


def _capture(t: Any, screen_id: str, notes: str) -> dict[str, Any]:
    return t.review_capture(screen_id, notes=notes)


def _capture_outcome(t: Any, screen_id: str, notes: str) -> dict[str, Any]:
    return _capture(t, screen_id, notes)


def _native_name(node: dict[str, Any]) -> str:
    return str(node.get("native_name", node.get("name") or ""))


def _native_state(t: Any, node: dict[str, Any]) -> dict[str, Any]:
    actual = t.accessibility(
        "checking exact native keyboard target", "find",
        "--name", _native_name(node), "--role", str(node["role"]),
        "--bus", str(node["bus"]), "--path", str(node["path"]), "--include-state",
    )
    if any(actual.get(key) != node.get(key) for key in ("bus", "path", "role")):
        raise RuntimeError(f"Native keyboard target changed identity: {actual!r}")
    if actual.get("native_name", actual.get("name", "")) != _native_name(node):
        raise RuntimeError(f"Native keyboard target name changed identity: {actual!r}")
    return actual


def _set_content_scrollbar(t: Any, node: dict[str, Any], fraction: float) -> float:
    result = t.accessibility(
        "setting actual Settings content scrollbar", "set-value",
        "--name", _native_name(node), "--role", str(node["role"]),
        "--bus", str(node["bus"]), "--path", str(node["path"]),
        "--fraction", str(fraction),
    )
    return float(result["actual"])


def _measure_label_window_bounds(t: Any, node: dict[str, Any]) -> list[int] | None:
    result = t.accessibility(
        "measuring exact Settings content label", "find",
        "--name", _native_name(node), "--role", str(node["role"]),
        "--bus", str(node["bus"]), "--path", str(node["path"]), "--window-bounds",
    )
    bounds = result.get("window_bounds")
    return bounds if isinstance(bounds, list) and len(bounds) == 4 else None


def _capture_page_bottom_with_wheel(
    t: Any, page: dict[str, Any], screen_id: str, notes: str
) -> dict[str, Any] | None:
    group = page["group"]
    labels: list[tuple[dict[str, Any], list[int], bool, dict[str, Any]]] = []
    interactive_roles = {
        "button", "push button", "toggle button", "check box", "radio button",
        "switch", "text", "text box", "combo box", "spin button", "slider",
        "menu item", "link",
    }

    clients = [
        client for client in t.clients()
        if client.get("title") == "Configurações" and client.get("mapped")
    ]
    if len(clients) != 1:
        raise RuntimeError(f"Cannot measure one mapped Settings client: {clients!r}")
    client = clients[0]
    at, size = client.get("at"), client.get("size")
    if (not isinstance(at, list) or len(at) != 2 or not isinstance(size, list)
            or len(size) != 2 or size[0] <= 0 or size[1] <= 0):
        raise RuntimeError(f"Invalid compositor Settings client geometry: {client!r}")

    def fits(bounds: list[int] | None, viewport: list[int]) -> bool:
        return bool(
            bounds is not None and bounds[2] > 0 and bounds[3] > 0
            and bounds[0] >= viewport[0] and bounds[1] >= viewport[1]
            and bounds[0] + bounds[2] <= viewport[0] + viewport[2]
            and bounds[1] + bounds[3] <= viewport[1] + viewport[3]
        )

    def collect(
        node: dict[str, Any], inside_control: bool = False, inside_row: bool = False,
        viewport: list[int] | None = None, nested_scroller: bool = False,
        scrollbar: dict[str, Any] | None = None,
    ) -> None:
        role = str(node.get("role", "")).casefold()
        inside_control = inside_control or role in interactive_roles
        inside_row = inside_row or role == "list item"
        scrollbars = [
            child for child in node.get("children", [])
            if str(child.get("role", "")).casefold() == "scroll bar"
            and isinstance(child.get("bounds"), list) and len(child["bounds"]) == 4
            and child["bounds"][3] > child["bounds"][2] > 0
        ]
        if scrollbars:
            if viewport is not None or len(scrollbars) != 1:
                nested_scroller = True
            else:
                scrollbar = scrollbars[0]
                viewport = _measure_label_window_bounds(t, node)
                scrollbar_bounds = _measure_label_window_bounds(t, scrollbars[0])
                if (viewport is None or scrollbar_bounds is None
                        or viewport[2] <= 0 or viewport[3] <= 0
                        or scrollbar_bounds[3] <= 0):
                    raise RuntimeError(f"Cannot measure Settings content scroller: {node!r}")
                top = max(viewport[1], scrollbar_bounds[1])
                bottom = min(viewport[1] + viewport[3], scrollbar_bounds[1] + scrollbar_bounds[3])
                viewport = [viewport[0], top, viewport[2], bottom - top]
        if not inside_control and not nested_scroller and viewport is not None and scrollbar is not None and role == "label":
            window_bounds = _measure_label_window_bounds(t, node)
            if (fits(window_bounds, [0, 0, size[0], size[1]])
                    and fits(window_bounds, viewport)
                    and _native_state(t, node).get("state_words", [0])[0] & (1 << 25)):
                labels.append((node, window_bounds, inside_row, scrollbar))
        for child in node.get("children", []):
            collect(child, inside_control, inside_row, viewport, nested_scroller, scrollbar)

    collect(group)
    if not labels:
        raise RuntimeError(
            "No fully visible native noneditable label inside the Settings content "
            "scroller and client is available for measured VNC wheel scrolling"
        )
    row_labels = [item for item in labels if item[2]]
    label, window_bounds, _, scrollbar = max(
        row_labels or labels, key=lambda item: item[1][2] * item[1][3]
    )
    x = int(at[0] + window_bounds[0] + window_bounds[2] / 2)
    y = int(at[1] + window_bounds[1] + window_bounds[3] / 2)

    def bounds() -> list[int] | None:
        return _measure_label_window_bounds(t, label)

    def wheel(button: str, count: int) -> None:
        actions = ["move", str(x), str(y)]
        for _ in range(count):
            actions.extend(("click", button, "pause", "0.05"))
        t.vnc("scrolling Settings over a measured noneditable label", *actions, timeout=25)

    def adjustment() -> dict[str, float]:
        # Use the same AT-SPI Value interface as the native set-value helper.
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
        result = t.desktop(
            "reading native Settings content adjustment",
            shlex.join(["python3", "-c", script, str(scrollbar["bus"]), str(scrollbar["path"])]),
            timeout=45,
        )
        values = json.loads(result.stdout)
        if (not isinstance(values, dict)
                or any(not isinstance(values.get(key), (int, float))
                       or not math.isfinite(values[key]) for key in ("minimum", "maximum", "current"))
                or values["minimum"] > values["maximum"]
                or not values["minimum"] <= values["current"] <= values["maximum"]):
            raise RuntimeError(f"Invalid native Settings content adjustment: {values!r}")
        return values

    def reset_to_top() -> list[int] | None:
        previous = bounds()
        stable = 0
        for _ in range(16):
            wheel("4", 10)
            current = bounds()
            stable = stable + 1 if current == previous else 0
            previous = current
            if stable >= 2:
                return current
        raise RuntimeError(f"Could not confirm top of Settings content; native label bounds={previous!r}")

    initial = adjustment()
    try:
        top = reset_to_top()
        top_adjustment = adjustment()
        if not math.isclose(top_adjustment["current"], top_adjustment["minimum"], abs_tol=0.01):
            raise RuntimeError(f"Wheel did not reach native Settings content top: {top_adjustment!r}")
        prior = top
        settled = 0
        for _ in range(16):
            wheel("5", 10)
            current = bounds()
            settled = settled + 1 if current == prior else 0
            prior = current
            if settled >= 2:
                break
        bottom = bounds()
        bottom_adjustment = adjustment()
        if bottom == top:
            proof = {
                "initial_adjustment": initial,
                "top_adjustment": top_adjustment,
                "bottom_adjustment": bottom_adjustment,
                "wheel_label": _native_name(label),
                "top": top, "bottom": bottom,
            }
            if bottom_adjustment["maximum"] > bottom_adjustment["minimum"]:
                evidence = t.review_capture(screen_id, notes=f"{notes} Native adjustment has a scrollable interval but wheel target did not move; proof={proof!r}.")
                return {**evidence, "status": "failed", "reason": "Native adjustment overflows without wheel movement", "scroll_proof": proof}
            evidence = t.review_capture(screen_id, notes=f"{notes} Native adjustment has no scrollable interval; proof={proof!r}.")
            return {**evidence, "scroll_proof": proof, "content_fits": True}
        if settled < 2:
            raise RuntimeError(f"Could not confirm stable bottom of Settings content; native label bounds={bottom!r}")
        if not math.isclose(bottom_adjustment["current"], bottom_adjustment["maximum"], abs_tol=0.01):
            raise RuntimeError(f"Wheel did not reach native Settings content bottom: {bottom_adjustment!r}")
        evidence = t.review_capture(
            screen_id,
            notes=f"{notes} Actual content reached its stable bottom via VNC wheel over native noneditable label {label.get('name')!r}; compositor client={client!r}, window-relative bounds={bottom!r}.",
        )
        return evidence
    finally:
        result = t.accessibility(
            "restoring initial Settings content adjustment", "set-value",
            "--name", _native_name(scrollbar), "--role", str(scrollbar["role"]),
            "--bus", str(scrollbar["bus"]), "--path", str(scrollbar["path"]),
            "--value", str(initial["current"]),
        )
        restored = adjustment()
        if (not math.isclose(float(result["actual"]), initial["current"], abs_tol=0.01)
                or not math.isclose(restored["current"], initial["current"], abs_tol=0.01)):
            raise RuntimeError(f"Settings content failed to return to its initial adjustment {initial!r}; found {restored!r}")


def _capture_page_overflow(
    t: Any, page: dict[str, Any], screen_id: str, notes: str
) -> dict[str, Any] | None:
    group = page.get("group")
    if not isinstance(group, dict):
        raise RuntimeError(f"Settings page has no actual content group: {page!r}")
    return _capture_page_bottom_with_wheel(t, page, screen_id, notes)



def _find_sidebar_row(t: Any, name: str) -> dict[str, Any]:
    tree = t.accessibility_tree(f"locating exact Settings sidebar row {name}")
    matches: list[dict[str, Any]] = []

    def visit(node: dict[str, Any], in_sidebar_list: bool = False) -> None:
        is_list = in_sidebar_list or str(node.get("role", "")).casefold() in {"list", "list box"}
        if (is_list and node.get("name") == name and node.get("role") == "list item"
                and _native_state(t, node).get("state_words", [0])[0] & (1 << 25)):
            matches.append(node)
        for child in node.get("children", []):
            visit(child, is_list)

    visit(tree)
    if len(matches) != 1:
        raise RuntimeError(f"Expected one exact {name!r} native sidebar row under a list; found {matches!r}")
    return matches[0]

def _click_native(t: Any, node: dict[str, Any], label: str) -> None:
    t.accessibility(
        label, "click", "--name", _native_name(node), "--role", str(node["role"]),
        "--bus", str(node["bus"]), "--path", str(node["path"]),
    )


def _ensure_sidebar_row(t: Any, name: str) -> dict[str, Any]:
    # Search-result -> section -> collapsed sidebar may require two actual
    # Back transitions. Re-read each state; never click a hidden cached row.
    for attempt in range(4):
        try:
            return _find_sidebar_row(t, name)
        except RuntimeError as collapsed_error:
            tree = t.accessibility_tree(f"finding actual Back control to expose Settings sidebar for {name}")
            back_buttons = [
                node for node in t.walk_accessibility(tree)
                if node.get("name") == "Voltar" and node.get("role") == "button"
                and _native_state(t, node).get("state_words", [0])[0] & (1 << 25)
            ]
            if len(back_buttons) != 1 or attempt == 3:
                raise RuntimeError(
                    f"Settings sidebar row {name!r} is not exposed after {attempt} real Back transitions; "
                    f"showing Back controls={back_buttons!r}; lookup={collapsed_error}"
                ) from collapsed_error
            _click_native(t, back_buttons[0], f"following actual Settings Back transition for {name}")
            t.vnc("allowing native Settings navigation transition", "pause", "0.4")



def _activate_native(t: Any, node: dict[str, Any], label: str) -> None:
    args = (
        "--name=" + _native_name(node), "--role", str(node["role"]),
        "--bus", str(node["bus"]), "--path", str(node["path"]),
    )
    clients = [client for client in t.clients()
               if client.get("title") == "Configurações" and client.get("mapped")]
    if len(clients) != 1:
        raise RuntimeError(f"Expected one mapped Settings client: {clients!r}")
    client = clients[0]
    at, size = client["at"], client["size"]

    def measure():
        return t.accessibility(
            label + " measuring current native target", "find", *args,
            "--window-bounds", "--include-state", "--include-actions",
        )

    measured = measure()
    bounds = measured.get("window_bounds")
    tree = t.accessibility_tree(label + " locating its owning content scroller")

    def branch(current):
        if current.get("bus") == node["bus"] and current.get("path") == node["path"]:
            return [current]
        for child in current.get("children", []):
            found = branch(child)
            if found:
                return [current, *found]
        return []

    for ancestor in reversed(branch(tree)[:-1]):
        scrollbars = [
            child for child in t.walk_accessibility(ancestor)
            if child.get("role") == "scroll bar" and child.get("bus") == node["bus"]
            and isinstance(child.get("bounds"), list)
            and child["bounds"][3] > child["bounds"][2] > 0
        ]
        if not scrollbars:
            continue
        if len(scrollbars) != 1:
            raise RuntimeError(f"Ambiguous owning scroller for {node}: {scrollbars}")
        scrollbar = scrollbars[0]
        viewport = _measure_label_window_bounds(t, scrollbar)
        if viewport is None or not isinstance(bounds, list):
            raise RuntimeError(f"Missing native scroll geometry: {scrollbar}, {measured}")
        if bounds[1] < viewport[1] or bounds[1] + bounds[3] > viewport[1] + viewport[3]:
            _set_content_scrollbar(t, scrollbar, 0)
            bounds = measure()["window_bounds"]
            t.accessibility(
                label + " scrolling the owning adjustment", "set-value",
                "--name=" + _native_name(scrollbar), "--role", scrollbar["role"],
                "--bus", str(scrollbar["bus"]), "--path", str(scrollbar["path"]),
                "--value", str(max(0, bounds[1] - viewport[1])),
            )
            measured = measure()
            bounds = measured.get("window_bounds")
        break

    if (not isinstance(bounds, list) or len(bounds) != 4
            or bounds[0] < 0 or bounds[1] < 0 or bounds[2] <= 0 or bounds[3] <= 0
            or bounds[0] + bounds[2] > size[0] or bounds[1] + bounds[3] > size[1]
            or not int(measured["state_words"][0]) & (1 << 25)):
        raise RuntimeError(f"Target is not inside the mapped Settings viewport: {measured}, {client}")
    if measured.get("actions"):
        t.accessibility(label, "click", *args)
    else:
        t.vnc(
            label + " by measured native pointer", "move",
            str(int(at[0] + bounds[0] + bounds[2] / 2)),
            str(int(at[1] + bounds[1] + bounds[3] / 2)), "click", "1",
        )


def _cancel_dialog(t: Any, title: str, screen_id: str) -> list[dict[str, Any]]:
    records = []
    try:
        t.wait_until(
            f"native dialog {title}",
            lambda: any(client.get("title") == title and client.get("mapped") for client in t.clients()),
            timeout=8,
        )
        records.append(_capture(t, screen_id, f"Actual native guest dialog {title!r}, before cancellation; no data submitted."))
    except Exception as exc:
        records.append({"screen_id": screen_id, "status": "failed", "reason": str(exc)})

    try:
        matches = [
            client for client in t.clients()
            if client.get("title") == title and client.get("mapped")
        ]
        if len(matches) > 1:
            raise RuntimeError(f"Ambiguous native dialog windows: {matches!r}")
        if matches:
            client = matches[0]
            address = str(client.get("address", ""))
            pid = client.get("pid")
            if not address or not pid:
                raise RuntimeError(f"Cannot identify native dialog by compositor address and PID: {client!r}")
            t.desktop(
                f"closing only the identified {title} dialog without submitting",
                "hyprctl dispatch " + shlex.quote(f'hl.dsp.window.close({{window = "address:{address}"}})'),
            )
            t.wait_until(
                f"identified native dialog {title} closed",
                lambda: not any(
                    item.get("title") == title
                    and item.get("mapped")
                    and item.get("address") == address
                    and item.get("pid") == pid
                    for item in t.clients()
                ),
                timeout=8,
            )
    except Exception as exc:
        records.append({"screen_id": screen_id + "-cleanup", "status": "failed", "reason": str(exc)})
    return records


def _close_compositor_client(t: Any, client: dict[str, Any], label: str) -> None:
    address = str(client.get("address", ""))
    pid = client.get("pid")
    if not address or not pid:
        raise RuntimeError(f"Cannot identify {label} by compositor address and PID: {client!r}")
    t.desktop(
        f"closing only the identified {label} without submitting",
        "hyprctl dispatch " + shlex.quote(f'hl.dsp.window.close({{window = "address:{address}"}})'),
    )
    t.wait_until(
        f"identified {label} closed",
        lambda: not any(
            item.get("address") == address and item.get("pid") == pid
            for item in t.clients()
        ),
        timeout=8,
    )

def _connection_editor_client(t: Any, title: str, pid: int, baseline: set[str]) -> dict[str, Any] | None:
    matches = [
        client for client in t.clients()
        if client.get("mapped") and client.get("title") == title
        and client.get("pid") == pid and str(client.get("address", "")) not in baseline
    ]
    if len(matches) > 1:
        raise RuntimeError(f"Ambiguous connection editor windows: {matches!r}")
    if matches and not matches[0].get("address"):
        raise RuntimeError(f"Connection editor has no compositor address: {matches[0]!r}")
    return matches[0] if matches else None


def _close_connection_editor(t: Any, title: str, pid: int, baseline: set[str]) -> None:
    client = _connection_editor_client(t, title, pid, baseline)
    if client is None:
        return
    address = str(client["address"])
    t.desktop(
        "closing only the identified connection editor without saving",
        "hyprctl dispatch " + shlex.quote(f'hl.dsp.window.close({{window = "address:{address}"}})'),
    )
    t.wait_until(
        "identified connection editor closed",
        lambda: not any(c.get("address") == address and c.get("pid") == pid for c in t.clients()),
        timeout=12,
    )


def _general_gsetting(t: Any, key: str, value: str | None = None) -> str:
    command_env = shlex.join([
        "env", "-u", "GSETTINGS_SCHEMA_DIR", "-u", "XDG_DATA_DIRS",
        *[f"{name}={item}" for name, item in t.gsettings_environment().items()],
    ])
    command = f"{command_env} gsettings "
    if value is not None:
        t.desktop(f"setting com.caioasmuniz.shade_shell.general.{key}", command + f"set com.caioasmuniz.shade_shell.general {shlex.quote(key)} {shlex.quote(value)}")
    return t.desktop(f"reading com.caioasmuniz.shade_shell.general.{key}", command + f"get com.caioasmuniz.shade_shell.general {shlex.quote(key)}").stdout.strip()


def _lock_workflow_with_busy_capture(t: Any) -> list[dict[str, Any]]:
    original_vnc = t.vnc
    original_capture = t.capture
    original_content = _general_gsetting(t, "notification-lockscreen-content").strip().lower() == "true"
    original_dnd = t.notification_dnd()
    notification_id = None
    summary = "Shade private lock review " + uuid.uuid4().hex


    def capture_busy(label: str, *args, **kwargs):
        result = original_vnc(label, *args, **kwargs)
        if label == "submit incorrect disposable lock credential":
            try:
                t.wait_until(
                    "actual PAM password-busy state",
                    lambda: t.find_accessible_node("Interromper tentativa", role="button"),
                    timeout=2,
                    interval=0.02,
                )
                t.review_capture(
                    "lock-password-busy",
                    notes="Actual password attempt is in flight; native Interromper tentativa control is present. No second authentication was submitted.",
                )
            except Exception as exc:
                t.review_unavailable("lock-password-busy", f"The real test-password attempt completed or the native busy control was not exposed before the safe observation window elapsed: {exc}")
        return result

    def capture_lock_privacy(name: str):
        screenshot = original_capture(name)
        if name == "password-lockscreen":
            tree = t.accessibility_tree("checking real notification redaction on the native lockscreen")
            labels = [str(node.get("name") or "") for node in t.walk_accessibility(tree)]
            redacted = "Nova notificação" in labels and "Conteúdo oculto até desbloquear." in labels
            leaked = any(summary in label for label in labels)
            if leaked:
                t.review_capture(
                    "lock-notification-content-leaked",
                    notes="The real guest notification's private summary was exposed while the lockscreen privacy switch was explicitly set to hide content.",
                )
                t.review_record(
                    "lock-hidden-notification",
                    "failed",
                    reason="Private notification summary was exposed while lockscreen notification content was disabled.",
                    reviewed=True,
                )
            elif redacted:
                t.review_capture(
                    "lock-hidden-notification",
                    notes="Real guest notification remained present on the native lockscreen, with generic redacted title/body and no private summary exposed.",
                )
            else:
                raise RuntimeError(
                    "Native lockscreen did not expose the expected redacted notification "
                    f"labels; redacted={redacted}. Actual tree retained in lockscreen capture."
                )
        return screenshot

    try:
        if original_content:
            _set_lock_notification_content(t, False)
        if original_dnd:
            t.notification_dnd(False)
        notification = t.desktop(
            "sending actual guest notification for lockscreen privacy review",
            "notify-send --print-id --expire-time=60000 --app-name=ShadeUIReview "
            + shlex.quote(summary) + " 'Private guest-only review notification'",
        ).stdout.strip()
        if notification.isdecimal():
            notification_id = notification
        t.vnc = capture_busy
        t.capture = capture_lock_privacy
        return t.review_run_scenario("test_lock_unlock")
    finally:
        t.vnc = original_vnc
        t.capture = original_capture
        if notification_id:
            t.desktop(
                "closing only the review notification after unlock",
                "gdbus call --session --dest org.freedesktop.Notifications "
                "--object-path /org/freedesktop/Notifications "
                "--method org.freedesktop.Notifications.CloseNotification " + shlex.quote(notification_id),
                check=False,
            )
        if original_dnd:
            t.notification_dnd(True)
        if original_content:
            _set_lock_notification_content(t, True)


def _set_lock_notification_content(t: Any, enabled: bool) -> None:
    t.open_settings()
    try:
        t.settings_page("Notificações")
        node = t.find_accessible_node("Mostrar conteúdo na tela bloqueada", role="switch")
        def active_state() -> bool:
            state = t.accessibility(
                "reading lockscreen notification-content privacy switch",
                "find", "--name", "Mostrar conteúdo na tela bloqueada", "--role", "switch",
                "--bus", str(node["bus"]), "--path", str(node["path"]), "--include-state",
            )
            return bool(int(state["state_words"][0]) & (1 << 4))
        if active_state() != enabled:
            t.click_accessible_node(node, "temporarily setting lockscreen notification privacy")
            t.wait_until("requested lockscreen notification privacy", lambda: active_state() == enabled, timeout=10)
    finally:
        t.close_settings()
        t.close_quick_settings()





def run_review(t: Any, theme: str, viewport: str) -> list[dict[str, Any]]:
    """Capture actual Settings/auth screens for one theme and viewport matrix cell."""
    records: list[dict[str, Any]] = []
    opened = False
    editor_pid: int | None = None
    editor_baseline: set[str] = set()
    profile_uuid = str(uuid.uuid4())
    profile_created = False
    profile_name = "Shade UI Review " + uuid.uuid4().hex[:10]
    ssid = "ShadeReview" + uuid.uuid4().hex[:8]
    try:
        opened = True
        records.append(_capture_outcome(t, "settings-wide-sidebar", f"Settings landing and sidebar; theme={theme}; viewport={viewport}."))

        # Assign the UUID before creation so cleanup remains exact even if the
        # command creates the profile but its response is lost.
        try:
            device = t.wifi_device()
            profile_created = True
            t.guest(
                "creating isolated guest NetworkManager saved-profile fixture before Settings pages initialize",
                "nmcli connection add type wifi ifname " + shlex.quote(device)
                + " con-name " + shlex.quote(profile_name)
                + " ssid " + shlex.quote(ssid)
                + " connection.uuid " + shlex.quote(profile_uuid)
                + " connection.autoconnect no wifi-sec.key-mgmt wpa-psk wifi-sec.psk shade-review-password",
            )
        except Exception as exc:
            records.append({"screen_id": "settings-connection-editor", "status": "unavailable" if exc.__class__.__name__ == "Unsupported" else "failed", "reason": str(exc)})

        for index, title in enumerate(SETTINGS_DESTINATIONS, 1):
            try:
                page = t.settings_page(title)
                records.append(_capture_outcome(
                    t, f"settings-destination-{index:02d}",
                    f"Native destination {title!r}, visible page={page.get('name')!r}; theme={theme}; viewport={viewport}.",
                ))
                try:
                    bottom = _capture_page_overflow(
                        t, page, f"settings-destination-{index:02d}-bottom",
                        f"Actual Settings content at the bottom of {title!r}; theme={theme}; viewport={viewport}.",
                    )
                    if bottom:
                        records.append(bottom)
                except Exception as scroll_error:
                    records.append({
                        "screen_id": f"settings-destination-{index:02d}-bottom",
                        "status": "failed",
                        "reason": str(scroll_error),
                        "title": title,
                    })
            except Exception as exc:
                records.append({"screen_id": f"settings-destination-{index:02d}", "status": "failed", "reason": str(exc), "title": title})

        try:
            t.settings_search("zzzz-no-settings-destination-zzzz")
            empty_group = t.find_accessible_node("Nenhuma preferência encontrada", role="group")
            empty_label = t.find_accessible_node("Nenhuma preferência encontrada", role="label")
            records.append(_capture_outcome(t, "settings-global-search-no-results", f"Actual unmatched query; native empty group bounds={empty_group.get('bounds')!r}, label bounds={empty_label.get('bounds')!r}."))
            t.settings_search("Bluetooth")
            result = t.wait_until(
                "Bluetooth Settings search result",
                lambda: t.find_in_group(t.accessibility_tree("waiting for Bluetooth Settings result"), "Resultados de busca", "Bluetooth", role="list item"),
                timeout=12,
            )
            _activate_native(t, result, "opening Bluetooth Settings search result by keyboard")
            page = t.wait_until(
                "Bluetooth destination after search",
                lambda: next((node for node in t.walk_accessibility(t.accessibility_tree("checking Bluetooth destination"))
                              if node.get("name") == "Bluetooth" and node.get("role") == "group"), None),
                timeout=12,
            )
            records.append(_capture_outcome(t, "settings-global-search-results", f"Native Bluetooth search result opened by verified keyboard activation; selected result={result!r}; page={page!r}."))
            t.accessibility("returning to preserved Bluetooth Settings search", "click", "--name", "Voltar", "--role", "button", "--description-match")
            t.wait_until("restored Bluetooth result", lambda: t.find_in_group(t.accessibility_tree("checking restored Bluetooth result"), "Resultados de busca", "Bluetooth", role="list item"), timeout=12)
            search = t.find_accessible_node("Buscar nas configurações", role="search box")
            def restored_search_focus():
                actual = _native_state(t, search)
                return actual if int(actual["state_words"][0]) & (1 << 12) else None
            search_state = t.wait_until(
                "search field focus actually restored by Settings Back",
                restored_search_focus,
                timeout=8,
            )
            records.append(_capture_outcome(t, "settings-global-search-back-focus", f"Back restored Bluetooth results; exact search field native FOCUSED={bool(int(search_state['state_words'][0]) & (1 << 12))}."))
            t.settings_search("")
        except Exception as exc:
            records.append({"screen_id": "settings-global-search-results-empty-back-focus", "status": "failed", "reason": str(exc)})

        # Capture all grouped section-index views via the actual sidebar, not a
        # fabricated registry list. Sidebar section names are accessible rows.
        for section in SETTINGS_SECTIONS:
            try:
                node = _ensure_sidebar_row(t, section)
                _activate_native(t, node, f"opening actual Settings sidebar section {section}")
                t.wait_until(f"Settings section {section}", lambda: any(
                    item.get("name") == section and item.get("role") in {"group", "heading"}
                    for item in t.walk_accessibility(t.accessibility_tree(f"checking section {section}"))), timeout=10)
                records.append(_capture_outcome(t, "settings-section-" + section.casefold().replace(" ", "-"), f"Actual sidebar section index {section!r}; theme={theme}; viewport={viewport}."))
            except Exception as exc:
                records.append({"screen_id": "settings-section-" + section.casefold().replace(" ", "-"), "status": "failed", "reason": str(exc)})


        radio = None
        wifi_change_attempted = False
        try:
            t.settings_page("Conexões")
            radio = t.guest("checking actual guest Wi-Fi radio for hidden network dialog", "nmcli radio wifi").stdout.strip()
            if radio == "disabled":
                wifi_switch = t.find_in_group(t.accessibility_tree("locating NetworkManager Wi-Fi switch"), "Adaptador Wi-Fi", "Wi-Fi", role="switch")
                wifi_change_attempted = True
                t.click_accessible_node(wifi_switch, "temporarily enabling guest Wi-Fi for dialog review")
                t.wait_until("guest Wi-Fi enabled for hidden dialog", lambda: t.guest("waiting for guest Wi-Fi enablement", "nmcli radio wifi").stdout.strip() == "enabled", timeout=20)
            elif radio != "enabled":
                raise RuntimeError(f"Unexpected guest NetworkManager Wi-Fi radio state: {radio!r}")
            hidden = t.find_accessible_node("Conectar à rede oculta…", role="list item")
            _activate_native(t, hidden, "opening native hidden-network entry from Settings")
            records.extend(_cancel_dialog(t, "Conectar à rede oculta", "settings-hidden-network-dialog"))
        except Exception as exc:
            records.append({"screen_id": "settings-hidden-network-dialog", "status": "failed", "reason": str(exc)})
        finally:
            if radio == "disabled" and wifi_change_attempted:
                try:
                    current_radio = t.guest(
                        "checking actual guest Wi-Fi radio before exact restoration",
                        "nmcli radio wifi",
                    ).stdout.strip()
                    if current_radio != radio:
                        t.guest(
                            "restoring original guest Wi-Fi radio directly through NetworkManager",
                            "nmcli radio wifi " + shlex.quote("off" if radio == "disabled" else "on"),
                        )
                        t.wait_until(
                            "restored original Wi-Fi radio off",
                            lambda: t.guest("verifying original Wi-Fi radio", "nmcli radio wifi").stdout.strip() == radio,
                            timeout=20,
                        )
                except Exception as exc:
                    records.append({"screen_id": "settings-hidden-network-radio-restore", "status": "failed", "reason": str(exc)})


        if profile_created:
            try:
                t.settings_page("Conexões")
                profile_row = t.wait_until(
                    "actual Settings profile row for the isolated guest fixture",
                    lambda: t.find_accessible_node(profile_name, role="list item"),
                    timeout=12,
                )
                editor_baseline = {
                    str(client.get("address")) for client in t.clients()
                    if client.get("address")
                }
                settings_clients = [
                    client for client in t.clients()
                    if client.get("title") == "Configurações" and client.get("mapped")
                ]
                if len(settings_clients) != 1 or not settings_clients[0].get("pid"):
                    raise RuntimeError(f"Cannot identify the Settings process for its connection editor: {settings_clients!r}")
                editor_pid = int(settings_clients[0]["pid"])
                _activate_native(t, profile_row, "opening the actual guest saved-network editor")
                t.wait_until(
                    "exact saved-network connection editor mapped",
                    lambda: _connection_editor_client(t, profile_name, editor_pid, editor_baseline),
                    timeout=12,
                )
                records.append(_capture(t, "settings-connection-editor", f"Actual guest saved-network editor {profile_name!r}, before cancellation; no data submitted."))
                _close_connection_editor(t, profile_name, editor_pid, editor_baseline)
            except Exception as exc:
                records.append({"screen_id": "settings-connection-editor", "status": "failed", "reason": str(exc)})
            finally:
                try:
                    if editor_pid is not None:
                        _close_connection_editor(t, profile_name, editor_pid, editor_baseline)
                except Exception as exc:
                    records.append({"screen_id": "settings-connection-editor-cleanup", "status": "failed", "reason": str(exc)})
        try:
            t.settings_page("Barra e dock")
            t.find_accessible_node("Adicionar aplicativo", role="text box")
            records.append(_capture_outcome(t, "settings-pinning-editor", "Actual inline pinning editor and existing pinned-app rows; no desktop ID entered or applied."))
        except Exception as exc:
            records.append({"screen_id": "settings-pinning-editor", "status": "failed", "reason": str(exc)})

        try:
            t.settings_page("Aplicativos padrão")
            records.append(_capture_outcome(t, "settings-default-app-formats", "Actual guest MIME/default-app families and chooser controls; no default changed."))
        except Exception as exc:
            records.append({"screen_id": "settings-default-app-formats", "status": "failed", "reason": str(exc)})

        try:
            t.settings_page("Relógio")
            menu_button = t.find_accessible_node("Adicionar fuso horário", role="button")
            _activate_native(t, menu_button, "opening the actual time-zone MenuButton")
            timezone_entry = t.wait_until(
                "native time-zone menu contents",
                lambda: t.find_accessible_node("UTC", role="button"),
                timeout=8,
            )
            records.append(_capture_outcome(t, "settings-timezone-menu", f"Native time-zone menu opened and exact preset {timezone_entry.get('name')!r} mapped; no zone selected."))
            t.vnc("cancelling native time-zone menu", "key", "esc", "pause", "0.3")
        except Exception as exc:
            records.append({"screen_id": "settings-timezone-menu", "status": "failed", "reason": str(exc)})

        baseline_clients: set[str] = set()
        chooser: dict[str, Any] | None = None
        try:
            t.settings_page("Aparência")
            baseline_clients = {str(client.get("address")) for client in t.clients()}
            wallpaper = t.find_accessible_node("Wallpaper do dia", role="list item")
            _activate_native(t, wallpaper, "opening guest wallpaper file chooser")
            def find_new_chooser():
                nonlocal chooser
                chooser = next((client for client in t.clients()
                                if client.get("mapped") and str(client.get("address")) not in baseline_clients), None)
                return chooser
            chooser = t.wait_until("native wallpaper chooser", find_new_chooser, timeout=10)
            records.append(_capture_outcome(t, "settings-wallpaper-file-chooser", f"Actual guest GTK file chooser {chooser.get('title')!r}; no path selected."))
            _close_compositor_client(t, chooser, "wallpaper file chooser")
        except Exception as exc:
            records.append({"screen_id": "settings-wallpaper-file-chooser", "status": "failed", "reason": str(exc)})
            if chooser:
                try:
                    current = next((client for client in t.clients()
                                    if client.get("address") == chooser.get("address")
                                    and client.get("pid") == chooser.get("pid")
                                    and client.get("mapped")), None)
                    if current:
                        _close_compositor_client(t, current, "wallpaper file chooser")
                except Exception as cleanup_exc:
                    records.append({"screen_id": "settings-wallpaper-file-chooser-cleanup", "status": "failed", "reason": str(cleanup_exc)})

        try:
            t.settings_page("Telas")
            records.append(_capture_outcome(t, "settings-layout-editor", "Actual saved-layout controls and guest output data; no name entered or layout saved."))
        except Exception as exc:
            records.append({"screen_id": "settings-layout-editor", "status": "failed", "reason": str(exc)})
        # The twenty-one destination captures above already cover these runtime pages.
        # Re-capturing them under a source-contract alias only duplicated evidence.

        try:
            sidebar_appearance = _ensure_sidebar_row(t, "Aparência")
            _activate_native(t, sidebar_appearance, "opening Appearance from the native Settings sidebar")
            t.wait_until(
                "Appearance page through sidebar",
                lambda: any(
                    node.get("name") == "Aparência" and node.get("role") == "group"
                    for node in t.walk_accessibility(t.accessibility_tree("checking responsive Appearance page"))
                ),
                timeout=12,
            )
            try:
                back_control = t.find_accessible_node("Voltar", role="button")
                back_visibility = {"present": True, "bounds": back_control.get("bounds")}
            except Exception:
                back_visibility = {"present": False}
            records.append(_capture_outcome(
                t, "settings-collapsed-sidebar-content",
                f"Actual sidebar-to-content responsive state at {viewport}; Back control observation={back_visibility}. Inspect screenshot and native bounds; no synthetic resize.",
            ))
        except Exception as exc:
            records.append({"screen_id": "settings-collapsed-sidebar-content", "status": "failed", "reason": str(exc)})

        if editor_pid is not None:
            try:
                _close_connection_editor(t, profile_name, editor_pid, editor_baseline)
            except Exception as exc:
                records.append({"screen_id": "settings-connection-editor-cleanup", "status": "failed", "reason": str(exc)})
        try:
            t.close_settings()
            opened = False
        except Exception as exc:
            records.append({"screen_id": "settings-close", "status": "failed", "reason": str(exc)})
        t.close_quick_settings()
        try:
            records.extend(t.review_run_scenario("test_displays_preview", include_native_tree=False))
        except Exception as exc:
            records.append({"screen_id": "settings-displays-preview-revert", "status": "unavailable" if exc.__class__.__name__ == "Unsupported" else "failed", "reason": str(exc)})
    except Exception as exc:
        records.append({"screen_id": "settings-review", "status": "failed", "reason": str(exc)})
    finally:
        if opened:
            if editor_pid is not None:
                try:
                    _close_connection_editor(t, profile_name, editor_pid, editor_baseline)
                except Exception as exc:
                    records.append({"screen_id": "settings-connection-editor-cleanup", "status": "failed", "reason": str(exc)})
            try:
                t.close_settings()
            except Exception as exc:
                records.append({"screen_id": "settings-close", "status": "failed", "reason": str(exc)})
        if profile_created:
            try:
                profiles = t.guest(
                    "checking whether only the isolated guest saved-profile fixture exists",
                    "nmcli -g UUID connection show",
                    check=False,
                )
                if profiles.returncode != 0:
                    raise RuntimeError(f"Could not list NetworkManager profile UUIDs: {profiles.stderr.strip()}")
                if profile_uuid in profiles.stdout.splitlines():
                    removed = t.guest(
                        "removing only isolated guest saved-profile fixture",
                        "nmcli connection delete uuid " + shlex.quote(profile_uuid),
                        check=False,
                    )
                    if removed.returncode != 0:
                        raise RuntimeError(f"Could not remove fixture UUID {profile_uuid}: {removed.stderr.strip()}")
            except Exception as exc:
                records.append({"screen_id": "settings-connection-editor-cleanup", "status": "failed", "reason": str(exc)})
        try:
            t.close_quick_settings()
        except Exception as exc:
            records.append({"screen_id": "settings-close-quick-settings", "status": "failed", "reason": str(exc)})

    try:
        records.extend(_lock_workflow_with_busy_capture(t))
    except Exception as exc:
        records.append({"screen_id": "lock-password-rejected-retry-unlock", "status": "unavailable" if exc.__class__.__name__ == "Unsupported" else "failed", "reason": str(exc)})

    try:
        records.extend(t.review_run_scenario("test_power_confirmation_cancel"))
    except Exception as exc:
        records.append({"screen_id": "power-popover-native-confirm-cancel", "status": "unavailable" if exc.__class__.__name__ == "Unsupported" else "failed", "reason": str(exc)})

    records.append(t.review_unavailable(
        "greeter-info-provider",
        "INFO requires an actual greeter information provider; none is configured in this guest. Manual-account and session-chooser evidence is captured by the standalone prelogin greeter journey, not by this post-login reviewer.",
    ))
    records.append(t.review_unavailable(
        "fingerprint-physical-authentication",
        "Physical fingerprint hardware/enrollment is not available to this guest. Any private fprintd protocol fixture remains protocol evidence only, not physical authentication.",
    ))
    return records
