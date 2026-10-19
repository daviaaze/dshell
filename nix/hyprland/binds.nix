{
  pkgs,
  lib,
  config,
  ...
}:
let
  uwsm-app = app: "${pkgs.uwsm}/bin/uwsm-app -t service -- ${app}.desktop";
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
  shade-action =
    action:
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

    "SUPER,left,movefocus,l"
    "SUPER,right,movefocus,r"
    "SUPER,up,movefocus,u"
    "SUPER,down,movefocus,d"
    "SUPERSHIFT,left,movewindow,l"
    "SUPERSHIFT,right,movewindow,r"
    "SUPERSHIFT,up,movewindow,u"
    "SUPERSHIFT,down,movewindow,d"
    "SUPERALT,up,workspace,previous_per_monitor"
    "SUPERALT,down,workspace,emptynm"
    "SUPERSHIFTALT,left,movewindow,mon:-1"
    "SUPERSHIFTALT,right,movewindow,mon:+1"
    "SUPERSHIFTALT,up,movetoworkspace,m-1"
    "SUPERSHIFTALT,down,movetoworkspace,emptynm"
    "SUPERALT,left,workspace,r-1"
    "SUPERALT,right,workspace,r+1"

    "SUPER,j,movefocus,l"
    "SUPER,l,movefocus,r"
    "SUPER,i,movefocus,u"
    "SUPER,k,movefocus,d"
    "SUPERSHIFT,j,movewindow,l"
    "SUPERSHIFT,l,movewindow,r"
    "SUPERSHIFT,i,movewindow,u"
    "SUPERSHIFT,k,movewindow,d"
    "SUPERALT,i,workspace,previous_per_monitor"
    "SUPERALT,k,workspace,emptynm"
    "SUPERSHIFTALT,i,movetoworkspace,m-1"
    "SUPERSHIFTALT,k,movetoworkspace,emptynm"
    "SUPERALT,j,workspace,r-1"
    "SUPERALT,l,workspace,r+1"
  ];

  _bindd = [
    "SUPER,M,shade-action:display-next,exec,shade-shell display-next"
    "SUPERALT,M,shade-action:display-mode-chooser,exec,shade-shell display-mode-chooser"
    "SUPERSHIFT,M,shade-action:display-toggle-internal,exec,shade-shell display-toggle-internal"
    ",XF86Display,shade-action:display-mode-chooser,exec,shade-shell display-mode-chooser"
    "SUPERSHIFT,V,shade-action:toggle-clipboard,exec,${shade-action "toggle-clipboard"}"
    "SUPER,Space,shade-action:toggle-applauncher,exec,${shade-action "toggle-applauncher"}"
    "SUPER,n,shade-action:toggle-quicksettings,exec,${shade-action "toggle-quicksettings"}"
    "SUPER,w,shade-action:toggle-bar,exec,${shade-action "toggle-bar"}"
    "SUPER,TAB,shade-action:toggle-windowswitcher,exec,${shade-action "toggle-windowswitcher"}"
    "SUPER,comma,shade-action:toggle-settings,exec,${shade-action "toggle-settings"}"
    ",Print,shade-action:screenshot-overlay,exec,${shade-action "screenshot-overlay"}"
    "SUPERSHIFT,S,shade-action:screenshot,exec,${shade-action "screenshot"}"
    "SUPERSHIFT,R,shade-action:record,exec,${shade-action "record"}"
    "SUPERSHIFT,P,shade-action:record-area,exec,${shade-action "record-area"}"
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
  # Bind/bindd lines share the first two fields (mods,key); bindd inserts a
  # description before dispatcher/arg. The legacy --locked prefix is normalized
  # by removing it before reading those fields.
  # ---------------------------------------------------------------------------

  # Split a bind string into its comma-separated fields.
  _splitBind = s: lib.splitString "," s;

  # Extract the key and modifiers from their fixed leading fields; later
  # dispatcher, description, and command fields may themselves contain commas.
  _keyOf =
    bindStr:
    let
      parts = _splitBind bindStr;
      cleaned = if builtins.head parts == "--locked" then builtins.tail parts else parts;
    in
    builtins.elemAt cleaned 1;

  _modsOf =
    bindStr:
    let
      parts = _splitBind bindStr;
      cleaned = if builtins.head parts == "--locked" then builtins.tail parts else parts;
    in
    [ (builtins.head cleaned) ];

  # A "mods+key" tuple uniquely identifies a Hyprland binding. Two entries
  # with the same tuple are a conflict.
  _tupleOf = bindStr: {
    mods = _modsOf bindStr;
    key = _keyOf bindStr;
  };

  _allBindLines = _bind ++ _bindd ++ _bindl ++ _bindle ++ _bindm ++ _binde;

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
    assert
      (_keyDuplicates == [ ])
      || throw "Duplicate Hyprland keybinds (Hyprland's silent last-wins hides the first): ${builtins.concatStringsSep "; " _keyDuplicates}";
    [ ];

in
{
  programs.hyprland.settings = {
    bind = _bind;
    bindd = _bindd;
    bindl = _bindl;
    bindle = _bindle;
    bindm = _bindm;
    binde = _binde;

    # Force the assertion to actually be evaluated.
    _forceAssert = _assertNoDupKeybinds;
  };
}
