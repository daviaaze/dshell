#!/usr/bin/env python3
"""Analyze screenshot content: brightness, blank detection, image comparison.
Uses PIL only — no numpy dependency."""

import sys
import os
from PIL import Image

def analyze_brightness(img):
    """Return average brightness (0-255) and perceived brightness."""
    gray = img.convert('L')
    pixels = list(gray.getdata())
    n = len(pixels)
    avg = sum(pixels) / n
    # Perceived brightness (ITU-R BT.709)
    rgb = img.convert('RGB')
    r, g, b = 0, 0, 0
    for px in rgb.getdata():
        r += px[0]
        g += px[1]
        b += px[2]
    perceived = (0.299 * r + 0.587 * g + 0.114 * b) / n
    return avg, perceived

def is_blank(img, variance_threshold=10.0):
    """Detect if image is blank or nearly blank by checking grayscale variance."""
    gray = img.convert('L')
    pixels = list(gray.getdata())
    n = len(pixels)
    mean = sum(pixels) / n
    variance = sum((p - mean) ** 2 for p in pixels) / n
    return variance < variance_threshold * variance_threshold, variance

def compare_images(path1, path2):
    """Compare two images. Returns diff percentage and mean absolute error."""
    img1 = Image.open(path1).convert('RGB')
    img2 = Image.open(path2).convert('RGB')
    # Resize to common size
    w = min(img1.width, img2.width)
    h = min(img1.height, img2.height)
    img1 = img1.resize((w, h), Image.LANCZOS)
    img2 = img2.resize((w, h), Image.LANCZOS)
    p1 = list(img1.getdata())
    p2 = list(img2.getdata())
    n = len(p1)
    diff_pixels = 0
    total_mae = 0
    for a, b in zip(p1, p2):
        d = sum(abs(a[i] - b[i]) for i in range(3))
        total_mae += d / 3
        if d > 30:  # threshold for "different pixel"
            diff_pixels += 1
    mae = total_mae / n
    diff_pct = (diff_pixels / n) * 100
    return mae, diff_pct

def analyze_file(path):
    """Full analysis of a single image file."""
    img = Image.open(path)
    avg, perceived = analyze_brightness(img)
    blank, variance = is_blank(img)
    return {
        'path': path,
        'size': img.size,
        'mode': img.mode,
        'avg_brightness': round(avg, 2),
        'perceived_brightness': round(perceived, 2),
        'is_blank': blank,
        'variance': round(variance, 2),
    }

def main():
    base = '/home/daviaaze/Projects/pessoal/dshell/test-output'
    screenshots = [
        '01-desktop.png',
        '02-applauncher-open.png',
        '03-applauncher-search.png',
        '04-applauncher-closed.png',
        '05-quicksettings-open.png',
        '06-quicksettings-closed.png',
        '07-bar-hidden.png',
        '08-bar-visible.png',
        '09-osd-volume.png',
        '__shade_ready_probe.png',
    ]
    # Also check full/ and recording/ dirs
    full_screenshots = [
        'full/f01-desktop.png',
        'full/f02-launcher.png',
        'full/f03-launcher-search.png',
        'full/f07-qs-open.png',
        'full/f09-qs-closed.png',
        'full/f10-bar-hidden.png',
        'full/f11-bar-visible.png',
        'recording/r01-launcher.png',
        'recording/r02-search.png',
        'recording/r03-qs.png',
        'recording/r04-bar-hidden.png',
        'recording/r05-bar-visible.png',
    ]

    all_paths = [os.path.join(base, p) for p in screenshots + full_screenshots]
    all_paths = [p for p in all_paths if os.path.exists(p)]

    print("=" * 80)
    print("SCREENSHOT ANALYSIS: Brightness & Blank Detection")
    print("=" * 80)
    for p in all_paths:
        result = analyze_file(p)
        rel = os.path.relpath(p, base)
        print(f"\n{rel}")
        print(f"  Size: {result['size']}, Mode: {result['mode']}")
        print(f"  Avg Brightness: {result['avg_brightness']}")
        print(f"  Perceived Brightness: {result['perceived_brightness']}")
        print(f"  Variance: {result['variance']}")
        print(f"  Is Blank: {result['is_blank']}")

    # Compare related pairs
    pairs = [
        ('01-desktop.png', 'full/f01-desktop.png'),
        ('02-applauncher-open.png', 'full/f02-launcher.png'),
        ('03-applauncher-search.png', 'full/f03-launcher-search.png'),
        ('05-quicksettings-open.png', 'full/f07-qs-open.png'),
        ('06-quicksettings-closed.png', 'full/f09-qs-closed.png'),
        ('07-bar-hidden.png', 'full/f10-bar-hidden.png'),
        ('08-bar-visible.png', 'full/f11-bar-visible.png'),
    ]
    print("\n" + "=" * 80)
    print("IMAGE COMPARISON: quick vs full screenshots")
    print("=" * 80)
    for a, b in pairs:
        pa = os.path.join(base, a)
        pb = os.path.join(base, b)
        if os.path.exists(pa) and os.path.exists(pb):
            mae, diff_pct = compare_images(pa, pb)
            print(f"\n{a}  vs  {b}")
            print(f"  Mean Absolute Error: {round(mae, 2)}")
            print(f"  Different Pixels: {round(diff_pct, 2)}%")

    # Compare recording mode screenshots
    rec_pairs = [
        ('full/f02-launcher.png', 'recording/r01-launcher.png'),
        ('full/f03-launcher-search.png', 'recording/r02-search.png'),
        ('full/f07-qs-open.png', 'recording/r03-qs.png'),
        ('full/f10-bar-hidden.png', 'recording/r04-bar-hidden.png'),
        ('full/f11-bar-visible.png', 'recording/r05-bar-visible.png'),
    ]
    print("\n" + "=" * 80)
    print("IMAGE COMPARISON: full vs recording mode")
    print("=" * 80)
    for a, b in rec_pairs:
        pa = os.path.join(base, a)
        pb = os.path.join(base, b)
        if os.path.exists(pa) and os.path.exists(pb):
            mae, diff_pct = compare_images(pa, pb)
            print(f"\n{a}  vs  {b}")
            print(f"  Mean Absolute Error: {round(mae, 2)}")
            print(f"  Different Pixels: {round(diff_pct, 2)}%")

    # Check for any obvious blank/black screenshots
    print("\n" + "=" * 80)
    print("BLANK / BLACK SCREEN DETECTION")
    print("=" * 80)
    for p in all_paths:
        result = analyze_file(p)
        rel = os.path.relpath(p, base)
        if result['is_blank']:
            print(f"  ⚠ BLANK: {rel} (variance={result['variance']})")
        elif result['avg_brightness'] < 20:
            print(f"  ⚠ VERY DARK: {rel} (brightness={result['avg_brightness']})")
        elif result['avg_brightness'] < 50:
            print(f"  ▪ Dark: {rel} (brightness={result['avg_brightness']})")
    print("\nDone.")

if __name__ == '__main__':
    main()
