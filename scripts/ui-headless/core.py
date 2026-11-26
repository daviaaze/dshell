"""Pure parsing, geometry and PNG assertions for headless Shade scenes."""
from dataclasses import dataclass
import json
import math
from pathlib import Path
import re
import shlex
import struct
import zlib

OUTPUT = "TEST-1"
SAFE_ACTIONS = frozenset({"toggle-applauncher", "toggle-quicksettings", "toggle-notifications"})
SAFE_NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]*\Z")


def parse_sizes(value):
    sizes = []
    for item in value.split(","):
        if not re.fullmatch(r"[1-9][0-9]*x[1-9][0-9]*", item):
            raise ValueError(f"invalid screen size: {item!r}; expected WIDTHxHEIGHT")
        size = tuple(map(int, item.split("x")))
        if size not in sizes:
            sizes.append(size)
    return sizes


def parse_scales(value):
    scales = []
    for item in value.split(","):
        scale = float(item)
        if not math.isfinite(scale) or scale <= 0:
            raise ValueError(f"invalid scale: {item!r}; expected a positive finite number")
        if scale not in scales:
            scales.append(scale)
    return scales


def hyprland_config(size, scale, shell_script):
    command = "bash " + shlex.quote(str(shell_script))
    return f'''hl.config({{debug = {{enable_stdout_logs = true, disable_scale_checks = true}}, animations = {{enabled = false}}}})
hl.monitor({{output = "eDP-1", disabled = true}})
hl.monitor({{output = "{OUTPUT}", mode = "{size[0]}x{size[1]}@60", position = "0x0", scale = {scale:g}}})
hl.on("hyprland.start", function()
    hl.exec_cmd("hyprctl output create headless {OUTPUT}")
    hl.exec_cmd({json.dumps(command)})
end)
'''


def owns_environment(data, root):
    prefix = str(root).encode() + b"/"
    for item in data.split(b"\0"):
        if item.startswith(b"XDG_RUNTIME_DIR="):
            return item[len(b"XDG_RUNTIME_DIR="):].startswith(prefix)
    return False


def find_layer(data, namespace, output=OUTPUT):
    for level in data.get(output, {}).get("levels", {}).values():
        for layer in level:
            if layer.get("namespace") == namespace:
                return layer
    return None


def logical_size(monitor):
    width, height = monitor["width"], monitor["height"]
    if monitor.get("transform", 0) % 2:
        width, height = height, width
    return width / monitor["scale"], height / monitor["scale"]


def capture_scale(monitor):
    """Keep grim's integer logical canvas at the output's physical size."""
    width, height = logical_size(monitor)
    logical_width = max(1, math.floor(width + .5))
    logical_height = max(1, math.floor(height + .5))
    # grim's implicit width-derived scale can truncate the other axis by one
    # pixel (2560x1440@1.5 became 2560x1439). Avoid a downward FP truncation too.
    return math.nextafter(max(monitor["width"] / logical_width, monitor["height"] / logical_height), math.inf)


def layer_assertions(layer, monitor):
    result = {"layer_present": layer is not None, "inside_monitor": False, "no_horizontal_overflow": False}
    if layer is None:
        return result
    width, height = logical_size(monitor)
    x, y = layer["x"] - monitor.get("x", 0), layer["y"] - monitor.get("y", 0)
    result["no_horizontal_overflow"] = x >= 0 and layer["w"] > 0 and x + layer["w"] <= width + 0.5
    result["inside_monitor"] = result["no_horizontal_overflow"] and y >= 0 and layer["h"] > 0 and y + layer["h"] <= height + 0.5
    return result


def layer_region(layer, monitor, inset=3):
    scale = monitor["scale"]
    return (round((layer["x"] - monitor.get("x", 0) + inset) * scale),
            round((layer["y"] - monitor.get("y", 0) + inset) * scale),
            max(1, round((layer["w"] - 2 * inset) * scale)),
            max(1, round((layer["h"] - 2 * inset) * scale)))


def unfilter_row(kind, row, previous, bpp):
    if kind == 0:
        return row
    result = bytearray(row)
    if kind not in (1, 2, 3, 4):
        raise ValueError(f"unsupported PNG filter {kind}")
    for i, value in enumerate(row):
        left = result[i - bpp] if i >= bpp else 0
        up = previous[i]
        if kind == 1:
            predictor = left
        elif kind == 2:
            predictor = up
        elif kind == 3:
            predictor = (left + up) // 2
        else:
            upper_left = previous[i - bpp] if i >= bpp else 0
            p = left + up - upper_left
            a, b, c = abs(p - left), abs(p - up), abs(p - upper_left)
            predictor = left if a <= b and a <= c else up if b <= c else upper_left
        result[i] = (value + predictor) & 255
    return bytes(result)


@dataclass
class PNG:
    width: int
    height: int
    channels: int
    pixels: bytes

    def clipped_region(self, region):
        x, y, width, height = region
        right, bottom = min(self.width, x + width), min(self.height, y + height)
        return max(0, x), max(0, y), right, bottom

    def region_nonuniform(self, region):
        x, y, right, bottom = self.clipped_region(region)
        if x >= right or y >= bottom:
            return False
        channels, stride = self.channels, self.width * self.channels
        first = self.pixels[y * stride + x * channels:y * stride + (x + 1) * channels]
        uniform = first * (right - x)
        return any(self.pixels[row * stride + x * channels:row * stride + right * channels] != uniform for row in range(y, bottom))

    def changed_pixels(self, baseline, region, tolerance=0):
        if (self.width, self.height, self.channels) != (baseline.width, baseline.height, baseline.channels):
            raise ValueError("baseline PNG dimensions or format changed")
        x, y, right, bottom = self.clipped_region(region)
        channels, stride = self.channels, self.width * self.channels
        return sum(self.pixels[i:i + channels] != baseline.pixels[i:i + channels]
                   and (not tolerance or any(abs(self.pixels[i + c] - baseline.pixels[i + c]) > tolerance for c in range(channels)))
                   for row in range(y, bottom)
                   for i in range(row * stride + x * channels, row * stride + right * channels, channels))


def read_png(path):
    data = Path(path).read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a PNG: {path}")
    offset, compressed, header = 8, [], None
    while offset + 12 <= len(data):
        size = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + size]
        if len(payload) != size:
            raise ValueError("truncated PNG chunk")
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", payload)
        elif kind == b"IDAT":
            compressed.append(payload)
        elif kind == b"IEND":
            break
        offset += size + 12
    if header is None:
        raise ValueError("PNG missing IHDR")
    width, height, depth, color, compression, filtering, interlace = header
    if depth != 8 or color not in (2, 6) or compression or filtering or interlace:
        raise ValueError("expected a non-interlaced 8-bit RGB/RGBA grim PNG")
    channels = 3 if color == 2 else 4
    stride = width * channels
    raw = zlib.decompress(b"".join(compressed))
    if len(raw) != height * (stride + 1):
        raise ValueError("PNG scanline length does not match dimensions")
    previous, rows = bytes(stride), []
    for start in range(0, len(raw), stride + 1):
        previous = unfilter_row(raw[start], raw[start + 1:start + 1 + stride], previous, channels)
        rows.append(previous)
    return PNG(width, height, channels, b"".join(rows))


def load_scene(path):
    scene = json.loads(Path(path).read_text())
    if not re.fullmatch(r"shade-[a-z-]+", scene.get("namespace", "")):
        raise ValueError(f"invalid scene namespace: {path}")
    steps = scene.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ValueError(f"scene must have steps: {path}")
    for step in steps:
        if not isinstance(step, dict) or len(step) != 1:
            raise ValueError("scene steps must contain exactly one operation")
        operation, value = next(iter(step.items()))
        if operation == "run":
            if value not in SAFE_ACTIONS:
                raise ValueError(f"unsafe action {value!r}; only panel toggles are allowed")
        elif operation == "shot":
            if not isinstance(value, str) or not SAFE_NAME.fullmatch(value):
                raise ValueError(f"invalid shot name: {value!r}")
        elif operation in ("wait_layer", "wait_closed"):
            if value != scene["namespace"]:
                raise ValueError("wait namespace must match scene namespace")
        elif operation in ("type", "key", "expect_text"):
            if not isinstance(value, str) or not value:
                raise ValueError(f"{operation} must be a non-empty string")
        elif operation == "click":
            if not isinstance(value, list) or len(value) != 2 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in value):
                raise ValueError("click expects two logical coordinates")
        else:
            raise ValueError(f"unsupported scene operation: {operation}")
    return scene
