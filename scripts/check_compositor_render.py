#!/usr/bin/env python3
"""Check that the Lua Hyprland is running was rendered from the current seed.

`shade-shell compositor render` runs once at login (UWSM launcher). A rebuild
that changes the seed (new window rules, misc settings) does nothing for the
running session until the next login, which silently hides rule changes. This
compares /etc/xdg/shade/compositor-seed.json against the rendered Lua and
lists what the render is missing.

Usage: check_compositor_render.py [seed.json] [rendered.lua]
Exit 0 when current, 1 when stale, 2 on unreadable input.
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


def missing_from_render(seed: dict, lua: str) -> list[str]:
    """Seed items an up-to-date render must contain but this one does not."""
    missing: list[str] = []

    for rule in seed.get("windowRules", []):
        if rule.get("enabled", True) is False:
            continue
        marker = f'name="{rule["id"]}"'
        if marker not in lua:
            missing.append(f"window rule {rule['id']}")

    # Layer rules carry no name; their effect keys and match values are the
    # only stable signal that the rule reached the render.
    for rule in seed.get("layerRules", []):
        if rule.get("enabled", True) is False:
            continue
        for key in rule.get("effects", {}):
            if f"{key}=" not in lua:
                missing.append(f"layer rule effect {key}")

    for section, values in seed.get("settings", {}).items():
        if not isinstance(values, dict):
            continue
        for key in values:
            if f'["{key}"]' not in lua:
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

    missing = missing_from_render(seed, lua)
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
