#!/usr/bin/env python3
"""Assert video dimensions and RGB samples from its deterministic middle frame."""

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


SAMPLE_RE = re.compile(r"(\d+),(\d+):#([0-9a-fA-F]{6})\Z")
DEFAULT_TOLERANCE = 12


class AssertionErrorWithMessage(Exception):
    pass


def parse_sample(value):
    match = SAMPLE_RE.fullmatch(value)
    if not match:
        raise argparse.ArgumentTypeError(
            "sample must use X,Y:#RRGGBB (for example 10,20:#ff00aa)"
        )
    x, y = int(match.group(1)), int(match.group(2))
    color = match.group(3)
    expected = tuple(int(color[i : i + 2], 16) for i in (0, 2, 4))
    return x, y, expected


def run_tool(command, tool_name):
    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        raise AssertionErrorWithMessage(f"could not run {tool_name}: {exc}") from exc
    if result.returncode:
        detail = result.stderr.decode("utf-8", "replace").strip().splitlines()
        message = detail[-1] if detail else f"exit status {result.returncode}"
        raise AssertionErrorWithMessage(f"{tool_name} failed: {message}")
    return result.stdout


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=(
            "Check a video's dimensions and RGB sample points in its deterministic "
            "middle frame."
        )
    )
    parser.add_argument("video", type=Path, help="video file to inspect")
    parser.add_argument("width", type=int, help="expected video width")
    parser.add_argument("height", type=int, help="expected video height")
    parser.add_argument(
        "--sample",
        action="append",
        type=parse_sample,
        default=[],
        metavar="X,Y:#RRGGBB",
        help="expected RGB color at a frame pixel; may be repeated",
    )
    parser.add_argument(
        "--tolerance",
        type=int,
        default=DEFAULT_TOLERANCE,
        metavar="N",
        help=f"maximum per-channel RGB difference (default: {DEFAULT_TOLERANCE})",
    )
    args = parser.parse_args(argv)
    if not args.sample:
        parser.error("at least one --sample assertion is required")


    if args.width <= 0 or args.height <= 0:
        parser.error("WIDTH and HEIGHT must be positive integers")
    if not 0 <= args.tolerance <= 255:
        parser.error("--tolerance must be between 0 and 255")
    for x, y, _ in args.sample:
        if x >= args.width or y >= args.height:
            parser.error(f"sample point {x},{y} is outside {args.width}x{args.height}")

    for tool in ("ffprobe", "ffmpeg"):
        if shutil.which(tool) is None:
            print(f"error: required tool '{tool}' was not found on PATH", file=sys.stderr)
            return 1

    if not args.video.is_file():
        print(f"error: video is missing or is not a regular file: {args.video}", file=sys.stderr)
        return 1
    try:
        if args.video.stat().st_size == 0:
            print(f"error: video is empty: {args.video}", file=sys.stderr)
            return 1
    except OSError as exc:
        print(f"error: cannot inspect video {args.video}: {exc}", file=sys.stderr)
        return 1

    try:
        raw = run_tool(
            [
                "ffprobe",
                "-v",
                "error",
                "-count_frames",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,nb_read_frames",
                "-of",
                "json",
                str(args.video),
            ],
            "ffprobe",
        )
        try:
            probe = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise AssertionErrorWithMessage(f"ffprobe returned invalid stream data: {exc}") from exc
        if not isinstance(probe, dict):
            raise AssertionErrorWithMessage("ffprobe returned invalid stream data")
        streams = probe.get("streams", [])
        if not streams:
            raise AssertionErrorWithMessage("video has no video stream")
        stream = streams[0]
        try:
            actual_width = int(stream["width"])
            actual_height = int(stream["height"])
            frame_count = int(stream["nb_read_frames"])
        except (KeyError, TypeError, ValueError) as exc:
            raise AssertionErrorWithMessage(
                "ffprobe did not report valid dimensions and a decoded frame count"
            ) from exc
        if actual_width != args.width or actual_height != args.height:
            raise AssertionErrorWithMessage(
                f"dimension mismatch: expected {args.width}x{args.height}, "
                f"got {actual_width}x{actual_height}"
            )
        if actual_width <= 0 or actual_height <= 0:
            raise AssertionErrorWithMessage("video stream has invalid dimensions")
        if frame_count <= 0:
            raise AssertionErrorWithMessage("video stream contains no decodable frames")

        middle_frame = (frame_count - 1) // 2
        pixels = run_tool(
            [
                "ffmpeg",
                "-v",
                "error",
                "-i",
                str(args.video),
                "-map",
                "0:v:0",
                "-vf",
                f"select=eq(n\\,{middle_frame})",
                "-vsync",
                "0",
                "-frames:v",
                "1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "pipe:1",
            ],
            "ffmpeg",
        )
        expected_size = actual_width * actual_height * 3
        if len(pixels) != expected_size:
            raise AssertionErrorWithMessage(
                f"ffmpeg decoded an incomplete frame: expected {expected_size} RGB bytes, "
                f"got {len(pixels)}"
            )
        for x, y, expected in args.sample:
            offset = (y * actual_width + x) * 3
            actual = tuple(pixels[offset : offset + 3])
            differences = tuple(abs(a - e) for a, e in zip(actual, expected))
            if any(difference > args.tolerance for difference in differences):
                actual_hex = "#" + "".join(f"{channel:02x}" for channel in actual)
                expected_hex = "#" + "".join(f"{channel:02x}" for channel in expected)
                raise AssertionErrorWithMessage(
                    f"sample {x},{y} mismatch: expected {expected_hex}, got {actual_hex} "
                    f"(tolerance {args.tolerance})"
                )
    except AssertionErrorWithMessage as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"video assertion passed: {args.width}x{args.height}, {len(args.sample)} sample(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
