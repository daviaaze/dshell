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
# Usage:
#   scripts/ui-test.sh            # run full sweep
#   scripts/ui-test.sh quicksettings launcher   # run a subset
#
# Locate ImageMagick (not on PATH outside nix shell).
MAGICK=$(command -v magick || true)
if [ -z "$MAGICK" ]; then
  MAGICK=$(ls -d /nix/store/*-imagemagick-7* 2>/dev/null | grep -vE -- '-(dev|doc|static)$|\.drv$' | head -1)/bin/magick
fi
if [ ! -x "$MAGICK" ]; then
  echo "ERROR: ImageMagick not found (tried PATH and nix store)" >&2
  exit 2
fi
# The reported bug is dark-mode over light content; force dark for the sweep.
SCHEMA=org.gnome.desktop.interface
ORIG_SCHEME=$(gsettings get $SCHEMA color-scheme 2>/dev/null || echo "")
trap 'gsettings set $SCHEMA color-scheme "$ORIG_SCHEME" 2>/dev/null' EXIT
gsettings set $SCHEMA color-scheme 'prefer-dark' 2>/dev/null
sleep 0.5
DEST=com.caioasmuniz.shade_shell
OBJ=/com/caioasmuniz/shade_shell
ACT=org.gtk.Actions.Activate


action() { gdbus call --session --dest "$DEST" --object-path "$OBJ" --method "$ACT" "$1" '[]' '{}' >/dev/null 2>&1; }

# Mean RGB of a crop region. Prints "r,g,b".
region_mean() { # file WxH+X+Y
  "$MAGICK" "$1" -crop "$2" +repage \
    -format "%[fx:round(mean.r*255)],%[fx:round(mean.g*255)],%[fx:round(mean.b*255)]" info: 2>/dev/null
}

# Pass if mean luminance is dark (< 120) => opaque dark surface over white page.
check_opaque() { # label file region
  local rgb mean
  rgb=$(region_mean "$2" "$3")
  mean=$(echo "$rgb" | awk -F, '{print int(($1+$2+$3)/3)}')
  if [ "$mean" -lt 120 ]; then
    echo "PASS  $1  mean=$rgb (opaque)"
    return 0
  else
    echo "FAIL  $1  mean=$rgb (translucent/washed-out)"
    return 1
  fi
}

# Focus the white test page (open it if needed).
ensure_white() {
  if [ ! -f /tmp/shade-white.html ]; then
    printf '<html><body style="background:#ffffff;margin:0"><h1 style="font-size:120px">WHITE CONTENT TEST</h1></body></html>' > /tmp/shade-white.html
  fi
  local addr
  addr=$(hyprctl clients -j 2>/dev/null | jq -r '.[] | select((.class|type=="string") and (.class=="zen-alpha" or (.class|test("chrome|firefox")))) | .address' | head -1)
  if [ -z "$addr" ]; then
    xdg-open /tmp/shade-white.html >/dev/null 2>&1
    sleep 2
    addr=$(hyprctl clients -j 2>/dev/null | jq -r '.[] | select((.class|type=="string") and (.class=="zen-alpha" or (.class|test("chrome|firefox")))) | .address' | head -1)
  fi
  [ -n "$addr" ] && hyprctl dispatch focuswindow "address:$addr" >/dev/null 2>&1
  sleep 0.6
}

close_all() { action close-all; sleep 0.4; }

failed=0
run() { # name action region
  local name=$1 act=$2 region=$3
  close_all
  action "$act"
  sleep 1.0
  local shot=/tmp/shade-ui-$name.png
  grim "$shot" 2>/dev/null
  check_opaque "$name" "$shot" "$region" || failed=1
}

ensure_white

TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=(quicksettings launcher osd windowswitcher bar)
for target in "${TARGETS[@]}"; do
  case "$target" in
    quicksettings)   run quicksettings   toggle-quicksettings   380x600+1490+300 ;;
    launcher)        run launcher        toggle-applauncher     200x600+20+300 ;;
    osd)             close_all
                     wpctl set-volume @DEFAULT_AUDIO_SINK@ 1%+ >/dev/null 2>&1; sleep 0.8
                     grim /tmp/shade-ui-osd.png 2>/dev/null
                     check_opaque osd /tmp/shade-ui-osd.png 120x40+900+1120 || failed=1 ;;
    windowswitcher)  run windowswitcher  toggle-windowswitcher  420x180+750+540 ;;
    bar)             grim /tmp/shade-ui-bar.png 2>/dev/null
                     check_opaque bar /tmp/shade-ui-bar.png 1900x40+10+8 || failed=1 ;;
  esac
done

close_all
echo
if [ "$failed" -eq 0 ]; then echo "=== UI opacity sweep PASSED ==="; else echo "=== UI opacity sweep FAILED ==="; fi
exit "$failed"
