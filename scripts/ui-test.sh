#!/usr/bin/env bash
# Shade UI test harness — objective, vision-independent verification.
#
# Opens each shell surface over a bright (white) test page, captures with
# grim, and pixel-samples the surface region with ImageMagick to assert the
# surface is OPAQUE (readable) rather than translucent (washed out).
#
# Why pixel-sampling: the agent's vision route is flaky; a dark surface over a
# white page must sample dark (RGB < ~120). A translucent surface samples near
# white (> ~200). This gives a hard pass/fail without needing to "see" it.
#
# Before a surface is opened, the same region is captured with everything
# closed and must read white: a dark desktop behind a missing surface would
# otherwise pass as "opaque". (The bar is always visible, so it has no such
# reference.)
#
# Usage:
#   scripts/ui-test.sh            # run full sweep
#   scripts/ui-test.sh quicksettings launcher   # run a subset
#
# Geometry below is for the author's monitor; override per machine with
#   SHADE_UI_QS_REGION SHADE_UI_LAUNCHER_REGION SHADE_UI_OSD_REGION
#   SHADE_UI_SWITCHER_REGION SHADE_UI_BAR_REGION   (ImageMagick WxH+X+Y)
# and the test page's window class with SHADE_UI_BROWSER_CLASS.
ALL_TARGETS=(quicksettings launcher osd windowswitcher bar)
QS_REGION=${SHADE_UI_QS_REGION:-380x600+1490+300}
LAUNCHER_REGION=${SHADE_UI_LAUNCHER_REGION:-200x600+20+300}
OSD_REGION=${SHADE_UI_OSD_REGION:-120x40+900+1120}
SWITCHER_REGION=${SHADE_UI_SWITCHER_REGION:-420x180+750+540}
BAR_REGION=${SHADE_UI_BAR_REGION:-1900x40+10+8}
BROWSER_CLASS=${SHADE_UI_BROWSER_CLASS:-zen-alpha}

# Reject unknown targets before touching any system state.
TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=("${ALL_TARGETS[@]}")
for target in "${TARGETS[@]}"; do
  case " ${ALL_TARGETS[*]} " in
    *" $target "*) ;;
    *) echo "ERROR: unknown target '$target' (known: ${ALL_TARGETS[*]})" >&2; exit 2 ;;
  esac
done

# Locate ImageMagick (not on PATH outside nix shell).
MAGICK=$(command -v magick || true)
if [ -z "$MAGICK" ]; then
  MAGICK=$(ls -d /nix/store/*-imagemagick-7* 2>/dev/null | grep -vE -- '-(dev|doc|static)$|\.drv$' | head -1)/bin/magick
fi
if [ ! -x "$MAGICK" ]; then
  echo "ERROR: ImageMagick not found (tried PATH and nix store)" >&2
  exit 2
fi
for tool in grim gdbus hyprctl jq gsettings; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: $tool not found" >&2; exit 2; }
done

# State this script changes, put back on exit. ORIG_VOLUME stays empty until
# the OSD target has actually changed the volume.
SCHEMA=org.gnome.desktop.interface
ORIG_SCHEME=
ORIG_VOLUME=
restore_state() {
  [ -n "$ORIG_VOLUME" ] && wpctl set-volume @DEFAULT_AUDIO_SINK@ "$ORIG_VOLUME" >/dev/null 2>&1
  [ -n "$ORIG_SCHEME" ] && gsettings set "$SCHEMA" color-scheme "$ORIG_SCHEME" 2>/dev/null
}
trap restore_state EXIT

# The reported bug is dark-mode over light content; force dark for the sweep.
# Refuse to change a setting that cannot be put back.
ORIG_SCHEME=$(gsettings get "$SCHEMA" color-scheme 2>/dev/null)
if [ -z "$ORIG_SCHEME" ]; then
  echo "ERROR: cannot read $SCHEMA color-scheme; not changing what cannot be restored" >&2
  exit 2
fi
if ! gsettings set "$SCHEMA" color-scheme 'prefer-dark' 2>/dev/null; then
  echo "ERROR: cannot force the dark color scheme" >&2
  exit 2
fi
sleep 0.5
DEST=com.caioasmuniz.shade_shell
OBJ=/com/caioasmuniz/shade_shell
ACT=org.gtk.Actions.Activate

# Activate a shell action; non-zero when the shell is not there to take it.
action() { gdbus call --session --dest "$DEST" --object-path "$OBJ" --method "$ACT" "$1" '[]' '{}' >/dev/null; }

# Fresh full-screen capture: a stale PNG from an earlier run must never be sampled.
capture() { # file
  rm -f "$1"
  grim "$1" 2>/dev/null && [ -s "$1" ]
}

# Mean RGB of a crop region. Prints "r,g,b".
region_mean() { # file WxH+X+Y
  "$MAGICK" "$1" -crop "$2" +repage \
    -format "%[fx:round(mean.r*255)],%[fx:round(mean.g*255)],%[fx:round(mean.b*255)]" info: 2>/dev/null
}

# Mean of the three channels of a region, or empty when it cannot be sampled.
region_luma() { # file region
  local rgb
  rgb=$(region_mean "$1" "$2")
  [[ $rgb =~ ^[0-9]+,[0-9]+,[0-9]+$ ]] || return 1
  echo "$rgb" | awk -F, '{print int(($1+$2+$3)/3)}'
}

# Pass if mean luminance is dark (< 120) => opaque dark surface over white page.
check_opaque() { # label file region
  local rgb mean
  rgb=$(region_mean "$2" "$3")
  mean=$(region_luma "$2" "$3")
  if [ -z "$mean" ]; then
    echo "FAIL  $1  cannot sample region $3 of $2"
    return 1
  fi
  if [ "$mean" -lt 120 ]; then
    echo "PASS  $1  mean=$rgb (opaque)"
    return 0
  else
    echo "FAIL  $1  mean=$rgb (translucent/washed-out)"
    return 1
  fi
}

# With every surface closed, the region must show the white test page.
check_white_reference() { # label region
  local file=/tmp/shade-ui-$1-reference.png mean
  if ! capture "$file"; then
    echo "FAIL  $1  grim could not capture the reference screen"
    return 1
  fi
  mean=$(region_luma "$file" "$2")
  if [ -z "$mean" ] || [ "$mean" -lt 200 ]; then
    echo "FAIL  $1  reference region $2 is not white (mean=${mean:-unreadable}); the test page is not behind it"
    return 1
  fi
  return 0
}

# Focus the white test page (open it if needed). Non-zero when there is none.
find_browser() {
  hyprctl clients -j 2>/dev/null | jq -r --arg cls "$BROWSER_CLASS" \
    '.[] | select((.class|type=="string") and (.class==$cls or (.class|test("chrome|firefox")))) | .address' | head -1
}
ensure_white() {
  if [ ! -f /tmp/shade-white.html ]; then
    printf '<html><body style="background:#ffffff;margin:0"><h1 style="font-size:120px">WHITE CONTENT TEST</h1></body></html>' > /tmp/shade-white.html
  fi
  local addr
  addr=$(find_browser)
  if [ -z "$addr" ]; then
    xdg-open /tmp/shade-white.html >/dev/null 2>&1
    sleep 2
    addr=$(find_browser)
  fi
  [ -n "$addr" ] || return 1
  hyprctl dispatch "hl.dsp.focus({window = \"address:$addr\"})" >/dev/null 2>&1 || return 1
  sleep 0.6
}

failed=0
close_all() {
  if ! action close-all; then
    echo "FAIL  close-all  the shell did not accept the action (is $DEST running?)"
    failed=1
    return 1
  fi
  sleep 0.4
}

run() { # name action region
  local name=$1 act=$2 region=$3
  close_all || return
  check_white_reference "$name" "$region" || { failed=1; return; }
  if ! action "$act"; then
    echo "FAIL  $name  the shell did not accept $act"
    failed=1
    return
  fi
  sleep 1.0
  local shot=/tmp/shade-ui-$name.png
  if ! capture "$shot"; then
    echo "FAIL  $name  grim could not capture the screen"
    failed=1
    return
  fi
  check_opaque "$name" "$shot" "$region" || failed=1
}

run_osd() {
  local volume shot=/tmp/shade-ui-osd.png
  close_all || return
  check_white_reference osd "$OSD_REGION" || { failed=1; return; }
  volume=$(wpctl get-volume @DEFAULT_AUDIO_SINK@ 2>/dev/null | awk '{print $2}')
  if [[ ! $volume =~ ^[0-9.]+$ ]]; then
    echo "FAIL  osd  cannot read the default sink volume to restore it afterwards"
    failed=1
    return
  fi
  ORIG_VOLUME=$volume
  if ! wpctl set-volume @DEFAULT_AUDIO_SINK@ 1%+ >/dev/null 2>&1; then
    echo "FAIL  osd  wpctl could not change the volume to trigger the OSD"
    failed=1
    return
  fi
  sleep 0.8
  if ! capture "$shot"; then
    echo "FAIL  osd  grim could not capture the screen"
    failed=1
    return
  fi
  check_opaque osd "$shot" "$OSD_REGION" || failed=1
}

run_bar() {
  local shot=/tmp/shade-ui-bar.png
  if ! capture "$shot"; then
    echo "FAIL  bar  grim could not capture the screen"
    failed=1
    return
  fi
  check_opaque bar "$shot" "$BAR_REGION" || failed=1
}

if ! ensure_white; then
  echo "ERROR: no browser window (class $BROWSER_CLASS, chrome or firefox) to serve as the white test page" >&2
  exit 2
fi

for target in "${TARGETS[@]}"; do
  case "$target" in
    quicksettings)   run quicksettings   toggle-quicksettings   "$QS_REGION" ;;
    launcher)        run launcher        toggle-applauncher     "$LAUNCHER_REGION" ;;
    osd)             run_osd ;;
    windowswitcher)  run windowswitcher  toggle-windowswitcher  "$SWITCHER_REGION" ;;
    bar)             run_bar ;;
  esac
done

close_all
echo
if [ "$failed" -eq 0 ]; then echo "=== UI opacity sweep PASSED ==="; else echo "=== UI opacity sweep FAILED ==="; fi
exit "$failed"
