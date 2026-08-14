{ pkgs, lib, config, ... }:
let
  uwsm-app = app : "${pkgs.uwsm}/bin/uwsm-app -t service -- ${app}.desktop";
  cfg = config.programs.shade.desktop;
  gdbus = lib.getExe' pkgs.glib "gdbus";
  # busctl (from systemd) is used for the ownership check.
  busctl = lib.getExe' pkgs.systemd "busctl";
  # shade-action: invoke a GAction on shade-shell via D-Bus. We:
  # 1. Check the bus name is owned (shade-shell is actually running).
  # 2. Call the action.
  # 3. On any failure, notify-send a visible error instead of silently
  #    swallowing it (the previous >/dev/null hiding typos and missing
  #    services alike).
  #
  # NOTE: The entire script MUST be on a single line. Hyprland's config
  # parser has no line-continuation mechanism (\ does not work), so any
  # newline inside a bind command produces an "Invalid config line" error.
  # We chain with || / && ; instead of multi-line if/fi blocks.
  #
  # gdbus NameHasOwner was replaced by busctl on purpose: on systems where
  # /usr/bin/gdbus (glib) is the one in PATH, NameHasOwner returns (false,)
  # for every name even when the bus name IS owned (observed on NixOS with
  # glib 2.88.1). busctl reports the truth, so the guard no longer
  # false-positives into the "not running" branch.
  shade-action = action:
    let
      dest = "com.caioasmuniz.shade_shell";
      object = "/com/caioasmuniz/shade_shell";
      method = "org.gtk.Actions.Activate";
      notify = lib.getExe pkgs.libnotify;
    in
    ''if ${busctl} --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s ${dest} | grep -q 'true'; then ${gdbus} call --session --dest ${dest} --object-path ${object} --method ${method} '${action}' '[]' '{}'; rc=$?; [ $rc -ne 0 ] && ${notify} -a shade-shell -u critical "shade-action '${action}' failed" "gdbus returned exit code $rc"; else ${notify} -a shade-shell -u critical "shade-action '${action}' failed" "shade-shell is not running (bus name ${dest} not owned)"; exit 1; fi'';

  # Raw bind lists (used by both hyprland and the duplicate detector).
  _bind = [
    "SUPER,Return,exec,${uwsm-app cfg.defaultTerminal}"
    "SUPER,B,exec,${uwsm-app cfg.defaultBrowser}"
    "SUPER,V,exec,pkill pwvucontrol || pwvucontrol"
    "SUPER,E,exec,${uwsm-app cfg.defaultFileManager}"
    "SUPER,C,exec,${uwsm-app "code"}"
    "SUPERSHIFT,V,exec,${shade-action "toggle-clipboard"}"

    # Was SUPERSHIFT,R, but that conflicts with screenshot record (same
    # mod+key tuple — Hyprland's silent last-wins would hide reload).
    "SUPER,Backspace,exec,hyprctl reload;${pkgs.libnotify}/bin/notify-send 'Hyprland reloaded'"
    "SUPERCTRL,R,exec,systemctl --user restart shade-shell"

    "SUPERSHIFT,Q,exec,pkill Hyprland"

    "SUPERSHIFT,F,togglefloating,active"
    "SUPERSHIFT,G,togglegroup"
    "SUPER,G,changegroupactive,f"
    "SUPER,Q,killactive"
    "SUPER,P,exec,hyprctl dispatch pseudo"
    "SUPERSHIFT,T,exec,hyprctl --batch 'dispatch togglefloating 1;dispatch resizeactive exact 1920 1080;dispatch togglefloating 0;dispatch pseudo'"
    "SUPER,F,fullscreen"
    ",Pause,togglespecialworkspace,scratchpad"
    ",Insert,togglespecialworkspace,scratchpad"
    "SUPER,Insert,movetoworkspace,special:scratchpad"
    "SUPER,Pause,movetoworkspace,special:scratchpad"
    "SUPER,S,layoutmsg,togglesplit"
    "SUPER,Space,exec,${shade-action "toggle-applauncher"}"
    "SUPER,n,exec,${shade-action "toggle-quicksettings"}"
    "SUPER,w,exec,${shade-action "toggle-bar"}"
    "SUPER,TAB,exec,${shade-action "toggle-windowswitcher"}"
    "SUPER,comma,exec,${shade-action "toggle-settings"}"

    ",Print,exec,${shade-action "screenshot-overlay"}"
    "SUPERSHIFT,S,exec,${shade-action "screenshot"}"
    "SUPERSHIFT,R,exec,${shade-action "record"}"
    "SUPERSHIFT,P,exec,${shade-action "record-area"}"

    "SUPER,left,movefocus,l"
    "SUPER,right,movefocus,r"
    "SUPER,up,movefocus,u"
    "SUPER,down,movefocus,d"
    "SUPERSHIFT,left,movewindow,l"
    "SUPERSHIFT,right,movewindow,r"
    "SUPERSHIFT,up,movewindow,u"
    "SUPERSHIFT,down,movewindow,d"
    "SUPERALT,up,workspace,previous"
    "SUPERALT,down,workspace,empty"
    "SUPERSHIFTALT,left,movewindow,mon:-1"
    "SUPERSHIFTALT,right,movewindow,mon:+1"
    "SUPERSHIFTALT,up,movetoworkspace,m-1"
    "SUPERSHIFTALT,down,movetoworkspace,empty"

    "SUPER,j,movefocus,l"
    "SUPER,l,movefocus,r"
    "SUPER,i,movefocus,u"
    "SUPER,k,movefocus,d"
    "SUPERSHIFT,j,movewindow,l"
    "SUPERSHIFT,l,movewindow,r"
    "SUPERSHIFT,i,movewindow,u"
    "SUPERSHIFT,k,movewindow,d"
    "SUPERALT,i,workspace,previous"
    "SUPERALT,k,workspace,empty"
    "SUPERSHIFTALT,i,movetoworkspace,m-1"
    "SUPERSHIFTALT,k,movetoworkspace,empty"
  ];

  # --locked: Hyprland 0.56.2 moved locked binds from `bind` to `bindl`/`bindle`.
  # The `--locked` prefix is no longer valid in `bind` — it now lives in
  # `bindl` (locked mouse/button binds) and `bindle` (locked empty-workspace binds).
  # These keys must work on the lockscreen too. Sway's own default config
  # uses --locked for the same reason.
  # NOTE: bindl requires a leading comma — the format is:
  #   bindl = ,<key>,exec,<command>
  # The leading comma marks an empty modifier field. Without it, Hyprland
  # 0.56.2 shifts fields and reports 'Invalid dispatcher'.
  _bindl = [
    ",XF86AudioMedia,exec,${pkgs.playerctl}/bin/playerctl play-pause"
    ",XF86AudioPlay,exec,${pkgs.playerctl}/bin/playerctl play-pause"
    ",XF86AudioStop,exec,${pkgs.playerctl}/bin/playerctl stop"
    ",XF86AudioPrev,exec,${pkgs.playerctl}/bin/playerctl previous"
    ",XF86AudioNext,exec,${pkgs.playerctl}/bin/playerctl next"
    ",XF86AudioMute,exec,wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"
    ",XF86AudioMicMute,exec,wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle"
    ",XF86MonBrightnessUp,exec,astal-brightness set +5%"
    ",XF86MonBrightnessDown,exec,astal-brightness set 5%-"
  ];

  _bindle = [
    ",XF86AudioRaiseVolume,exec,wpctl set-volume -l '1.0' @DEFAULT_AUDIO_SINK@ 5%+"
    ",XF86AudioLowerVolume,exec,wpctl set-volume -l '1.0' @DEFAULT_AUDIO_SINK@ 5%-"
  ];

  _bindm = [
    "SUPER,mouse:272,movewindow"
    "SUPER,mouse:273,resizewindow"
  ];

  _binde = [
    "SUPERCONTROL,left,resizeactive,-64 0"
    "SUPERCONTROL,right,resizeactive,64 0"
    "SUPERCONTROL,up,resizeactive,0 -64"
    "SUPERCONTROL,down,resizeactive,0 64"
    "SUPERCONTROL,j,resizeactive,-64 0"
    "SUPERCONTROL,l,resizeactive,64 0"
    "SUPERCONTROL,i,resizeactive,0 -64"
    "SUPERCONTROL,k,resizeactive,0 64"
  ];

  # ---------------------------------------------------------------------------
  # Conflict detection — GNOME and KDE warn about duplicate keybinds at
  # runtime; Hyprland silently takes the last entry. Catch duplicates at
  # build time so we never ship a dead key.
  #
  # Bind line format: "[--locked],<mods>,<key>,<dispatcher>,<arg>". The key
  # is always the second comma-separated field (or third if --locked).
  # ---------------------------------------------------------------------------

  # Split a bind string into its comma-separated fields.
  _splitBind = s: lib.splitString "," s;

  # Extract the "key" field from a bind string. The key is the field right
  # before the dispatcher, which is always the second field (or third if
  # --locked is present).
  _keyOf = bindStr:
    let parts = _splitBind bindStr;
    in
    if builtins.head parts == "--locked" then builtins.elemAt parts 2 else builtins.elemAt parts 1;

  # Extract the "modifiers" portion (everything before the key). Used to
  # disambiguate e.g. "SUPER,comma" vs ",comma" (the latter being
  # unmodded).
  _modsOf = bindStr:
    let
      parts = _splitBind bindStr;
      # Drop --locked if present, then drop the last two fields
      # (dispatcher + arg) to leave just the modifiers.
      cleaned = if builtins.head parts == "--locked" then builtins.tail parts else parts;
      modCount = builtins.length cleaned - 2;
    in
    lib.take modCount cleaned;

  # A "mods+key" tuple uniquely identifies a Hyprland binding. Two entries
  # with the same tuple are a conflict.
  _tupleOf = bindStr: { mods = _modsOf bindStr; key = _keyOf bindStr; };

  _allBindLines = _bind ++ _bindl ++ _bindle ++ _bindm ++ _binde;

  # Find duplicate (mods,key) tuples.
  _keyDuplicates =
    let
      entries = map _tupleOf _allBindLines;
      isDupe = e: builtins.length (builtins.filter (x: x.mods == e.mods && x.key == e.key) entries) > 1;
      dupes = builtins.filter isDupe entries;
      fmt = e: "${builtins.concatStringsSep "," e.mods},${e.key}";
    in
    map fmt dupes;

  # Assertion fires at nixos-rebuild time.
  _assertNoDupKeybinds =
    assert (_keyDuplicates == [ ])
      || throw "Duplicate Hyprland keybinds (Hyprland's silent last-wins hides the first): ${builtins.concatStringsSep "; " _keyDuplicates}";
    [ ];

in
{
  programs.hyprland.settings = {
    bind = _bind;
    bindl = _bindl;
    bindle = _bindle;
    bindm = _bindm;
    binde = _binde;

    # Force the assertion to actually be evaluated.
    _forceAssert = _assertNoDupKeybinds;
  };
}
