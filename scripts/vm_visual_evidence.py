#!/usr/bin/env python3
"""Select visual changes in a VM recording and render reviewable ROI evidence."""

from __future__ import annotations

import bisect
import json
import math
import re
import subprocess
import tempfile
from pathlib import Path


SAMPLE_SIZE = 64
FRAME_BYTES = SAMPLE_SIZE * SAMPLE_SIZE
MAX_TRANSITIONS = 6
MAX_FRAMES = 18000
MIN_MEAN_CHANGE = 8.0


def _run(command: list[str], *, action: str) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(command, text=True, capture_output=True, check=False)
    except FileNotFoundError as exc:
        raise RuntimeError(f"{action}: install {command[0]} and ensure it is on PATH") from exc
    if result.returncode:
        raise RuntimeError(f"{action}: {result.stderr.strip() or f'{command[0]} exited {result.returncode}'}")
    return result


def _probe(video: Path, region: tuple[int, int, int, int]) -> list[float]:
    if not video.is_file():
        raise ValueError(f"Video does not exist or is not a file: {video}")
    if len(region) != 4 or any(type(value) is not int for value in region):
        raise ValueError("ROI must be (x, y, width, height) with integer coordinates")
    x, y, width, height = region
    if x < 0 or y < 0 or width <= 0 or height <= 0:
        raise ValueError(f"ROI must have nonnegative origin and positive size: {region}")

    dimensions = _run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height", "-of", "json", str(video)],
        action=f"Probing video dimensions for {video}",
    )
    try:
        stream = json.loads(dimensions.stdout)["streams"][0]
        video_width, video_height = int(stream["width"]), int(stream["height"])
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise ValueError(f"No decodable video dimensions in {video}") from exc
    if x + width > video_width or y + height > video_height:
        raise ValueError(
            f"ROI {region} exceeds {video_width}x{video_height} video bounds for {video}"
        )

    timestamps = _run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-read_intervals",
         f"%+#{MAX_FRAMES + 1}", "-show_frames",
         "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(video)],
        action=f"Probing frame timestamps for {video}",
    )
    try:
        times = [
            float(frame["best_effort_timestamp_time"])
            for frame in json.loads(timestamps.stdout)["frames"]
        ]
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError(f"Missing or invalid frame PTS in {video}") from exc
    if not times or not all(math.isfinite(value) for value in times):
        raise ValueError(f"No finite video frame PTS in {video}")
    if len(times) > MAX_FRAMES:
        raise ValueError(f"Recording exceeds {MAX_FRAMES} frames; analyze shorter event-centered clips")
    return times


def analyze_video(
    video: Path, region: tuple[int, int, int, int], *, sample_times: list[float] | None = None
) -> dict:
    """Analyze native frame PTS and streaming 64x64 grayscale ROI frame differences."""
    video = Path(video)
    times = _probe(video, region)
    x, y, width, height = region
    command = [
        "ffmpeg", "-v", "error", "-i", str(video), "-map", "0:v:0", "-an", "-sn", "-dn",
        "-vf", f"crop={width}:{height}:{x}:{y}:exact=1,scale={SAMPLE_SIZE}:{SAMPLE_SIZE}:flags=area,format=gray",
        "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ]
    changes: list[tuple[int, float]] = []
    frame_count = 0
    with tempfile.TemporaryFile() as errors:
        try:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors)
        except FileNotFoundError as exc:
            raise RuntimeError("Decoding video: install ffmpeg and ensure it is on PATH") from exc
        assert process.stdout is not None
        previous: bytes | None = None
        try:
            while True:
                frame_buffer = bytearray()
                while len(frame_buffer) < FRAME_BYTES:
                    chunk = process.stdout.read(FRAME_BYTES - len(frame_buffer))
                    if not chunk:
                        break
                    frame_buffer.extend(chunk)
                if not frame_buffer:
                    break
                if len(frame_buffer) != FRAME_BYTES:
                    raise RuntimeError(f"Incomplete decoded frame {frame_count} in {video}")
                frame = bytes(frame_buffer)
                if previous is not None:
                    difference = sum(abs(a - b) for a, b in zip(previous, frame)) / FRAME_BYTES
                    if difference >= MIN_MEAN_CHANGE:
                        changes.append((frame_count, difference))
                previous = frame
                frame_count += 1
        except BaseException:
            process.kill()
            process.wait()
            raise
        finally:
            process.stdout.close()
        status = process.wait()
        if status:
            errors.seek(0)
            detail = errors.read().decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"Decoding ROI from {video} failed: {detail or f'ffmpeg exited {status}'}")
    if frame_count != len(times):
        raise RuntimeError(
            f"Frame count mismatch for {video}: ffprobe reported {len(times)} PTS, "
            f"ffmpeg decoded {frame_count} frames; check video integrity"
        )
    best = sorted(changes, key=lambda change: (-change[1], change[0]))[:MAX_TRANSITIONS]
    keyframes = {0, frame_count - 1}
    for index, _ in best:
        keyframes.update((index - 1, index))
    for timestamp in sample_times or []:
        if math.isfinite(timestamp):
            keyframes.add(min(bisect.bisect_left(times, timestamp), frame_count - 1))
    return {
        "frame_count": frame_count,
        "frame_times": times,
        "change_frames": [index for index, _ in changes],
        "keyframes": sorted(keyframes),
    }


def render_evidence(
    video: Path, region: tuple[int, int, int, int], output_dir: Path, *, label: str,
    sample_times: list[float] | None = None,
) -> dict:
    """Write native-resolution ROI PNGs and a labeled contact sheet for chosen frames."""
    video = Path(video)
    output_dir = Path(output_dir)
    analysis = analyze_video(video, region, sample_times=sample_times)
    output_dir.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", label).strip("-") or "evidence"
    x, y, width, height = region
    indices = analysis["keyframes"]
    select = "+".join(f"eq(n\\,{index})" for index in indices)
    frames: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix=f".{slug}-frames-", dir=output_dir) as temporary:
        pattern = Path(temporary) / "frame-%06d.png"
        _run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(video), "-map", "0:v:0",
             "-vf", f"select={select},crop={width}:{height}:{x}:{y}:exact=1",
             "-fps_mode", "passthrough", "-start_number", "0", "-frames:v", str(len(indices)),
             str(pattern)],
            action=f"Extracting selected ROI frames from {video}",
        )
        for sequence, index in enumerate(indices):
            timestamp = analysis["frame_times"][index]
            extracted = Path(temporary) / f"frame-{sequence:06d}.png"
            image = output_dir / f"{slug}-frame-{index:06d}-t{timestamp:.6f}s.png"
            if not extracted.is_file() or extracted.stat().st_size == 0:
                raise RuntimeError(f"ffmpeg produced no PNG for frame {index} of {video}: {extracted}")
            extracted.replace(image)
            frames.append({"index": index, "time": timestamp, "path": str(image.resolve())})

    columns = min(4, len(frames))
    filters = []
    for position, frame in enumerate(frames):
        caption = f"frame {frame['index']}  {frame['time']:.3f}s"
        filters.append(
            f"[{position}:v]scale=320:180:force_original_aspect_ratio=decrease,"
            f"pad=320:216:(ow-iw)/2:0:color=black,"
            f"drawtext=text='{caption}':x=8:y=190:fontsize=16:fontcolor=white[t{position}]"
        )
    layout = "|".join(f"{position % columns * 320}_{position // columns * 216}" for position in range(len(frames)))
    filters.append(
        "".join(f"[t{position}]" for position in range(len(frames)))
        + f"xstack=inputs={len(frames)}:layout={layout}:fill=black[sheet]"
    )
    sheet = output_dir / f"{slug}-contact-sheet.png"
    _run(
        ["ffmpeg", "-v", "error", "-y", *(
            argument for frame in frames for argument in ("-loop", "1", "-i", str(frame["path"]))
        ), "-filter_complex", ";".join(filters), "-map", "[sheet]", "-frames:v", "1", str(sheet)],
        action=f"Building labeled contact sheet for {video}",
    )
    if not sheet.is_file() or sheet.stat().st_size == 0:
        raise RuntimeError(f"ffmpeg produced no contact sheet for {video}: {sheet}")
    return {
        **analysis,
        "video_decode_passes": 2,
        "video": str(video.resolve()),
        "region": list(region),
        "label": label,
        "frames": frames,
        "keyframe_pngs": [frame["path"] for frame in frames],
        "contact_sheet": str(sheet.resolve()),
    }
