#!/usr/bin/env python3
"""Check that the Lua Hyprland is running was rendered from the current seed.

`shade-shell compositor render` runs once at login (UWSM launcher). A rebuild
that changes the seed (new window rules, misc settings) does nothing for the
running session until the next login, which silently hides rule changes. This
compares /etc/xdg/shade/compositor-seed.json against the rendered Lua and
lists what the render is missing.

Usage: check_compositor_render.py [seed.json] [rendered.lua]
Exit 0 when current, 1 when stale, 2 on unreadable or malformed input.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

DEFAULT_SEED = Path("/etc/xdg/shade/compositor-seed.json")


def default_rendered() -> Path:
    runtime = os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    return Path(os.environ.get("SHADE_COMPOSITOR_RENDERED", f"{runtime}/shade/hyprland.lua"))


def lua_string(value: str) -> str:
    """Mirror luaString() in packages/compositor-model/src/index.ts."""
    output = ['"']
    for char in value:
        code = ord(char)
        if char in '"\\':
            output.append("\\" + char)
        elif char == "\n":
            output.append("\\n")
        elif char == "\r":
            output.append("\\r")
        elif char == "\t":
            output.append("\\t")
        elif code < 32 or code == 127:
            output.append(f"\\{code:03d}")
        else:
            output.append(char)
    output.append('"')
    return "".join(output)


def lua_scalar(value: object) -> str | None:
    """Lua text of a string or boolean seed value; None when it is not one."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return lua_string(value)
    return None


def table_body(lua: str, header: str) -> str | None:
    """Text between the braces opened by `header` (which ends in `{`), strings skipped."""
    start = lua.find(header)
    if start < 0:
        return None
    begin = start + len(header)
    depth, index, in_string = 1, begin, False
    while index < len(lua):
        char = lua[index]
        if in_string:
            if char == "\\":
                index += 1
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return lua[begin:index]
        index += 1
    return None


def missing_from_render(seed: dict, lua: str) -> list[str]:
    """Seed items an up-to-date render must contain but this one does not.

    Raises KeyError, AttributeError or TypeError when the seed is malformed.
    """
    missing: list[str] = []

    for rule in seed.get("windowRules", []):
        if rule.get("enabled", True) is False:
            continue
        if f"hl.window_rule({{name={lua_string(rule['id'])}" not in lua:
            missing.append(f"window rule {rule['id']}")

    # Layer rules carry no name: a rule reached the render when one
    # hl.layer_rule line holds its match and each of its effect keys.
    layer_lines = [line for line in lua.splitlines() if line.startswith("hl.layer_rule(")]
    for rule in seed.get("layerRules", []):
        if rule.get("enabled", True) is False:
            continue
        pairs = [f"[{lua_string(key)}] = {text}" for key, value in rule.get("match", {}).items()
                 if (text := lua_scalar(value)) is not None]
        candidates = [line for line in layer_lines if all(pair in line for pair in pairs)]
        if not candidates:
            missing.append(f"layer rule {json.dumps(rule.get('match', {}), ensure_ascii=False)}")
            continue
        for key in rule.get("effects", {}):
            if not any(f", {key}=" in line for line in candidates):
                missing.append(f"layer rule effect {key}")

    for section, values in seed.get("settings", {}).items():
        if not isinstance(values, dict):
            continue
        body = table_body(lua, f"[{lua_string(section)}] = {{")
        for key in values:
            if body is None or f"[{lua_string(key)}]" not in body:
                missing.append(f"setting {section}.{key}")

    return missing


def main(argv: list[str]) -> int:
    seed_path = Path(argv[1]) if len(argv) > 1 else DEFAULT_SEED
    lua_path = Path(argv[2]) if len(argv) > 2 else default_rendered()
    try:
        seed = json.loads(seed_path.read_text(encoding="utf-8"))
        lua = lua_path.read_text(encoding="utf-8")
    except (OSError, ValueError) as error:
        print(f"cannot read input: {error}", file=sys.stderr)
        return 2

    try:
        missing = missing_from_render(seed, lua)
    except (KeyError, AttributeError, TypeError) as error:
        print(f"malformed seed {seed_path}: {type(error).__name__}: {error}", file=sys.stderr)
        return 2
    if missing:
        print(f"{lua_path} is stale versus {seed_path}; missing:", file=sys.stderr)
        for item in missing:
            print(f"  - {item}", file=sys.stderr)
        print("Log out and back in, or run `shade-shell compositor render` then `hyprctl reload`.", file=sys.stderr)
        return 1
    print("rendered compositor config is current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
