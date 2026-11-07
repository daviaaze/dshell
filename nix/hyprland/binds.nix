{
  pkgs,
  lib,
  config,
  ...
}:
let
  uwsm-app = app: "${pkgs.uwsm}/bin/uwsm-app -t service -- ${app}.desktop";
  cfg = config.programs.shade.desktop;
  # Use compositor-native dispatchers for interactive bindings. External
  # commands remain exec_cmd actions so existing shell helpers are preserved.
  shade-action = action:
    let
      dest = "com.caioasmuniz.shade_shell";
      object = "/com/caioasmuniz/shade_shell";
      method = "org.gtk.Actions.Activate";
      notify = lib.getExe pkgs.libnotify;
    in
    ''if ${lib.getExe' pkgs.systemd "busctl"} --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s ${dest} | grep -q 'true'; then ${lib.getExe' pkgs.glib "gdbus"} call --session --dest ${dest} --object-path ${object} --method ${method} '${action}' '[]' '{}'; rc=$?; [ $rc -ne 0 ] && ${notify} -a shade-shell -u critical "shade-action '${action}' failed" "gdbus returned exit code $rc"; else ${notify} -a shade-shell -u critical "shade-action '${action}' failed" "shade-shell is not running (bus name ${dest} not owned)"; exit 1; fi'';
  hyprctl = lib.getExe' config.programs.hyprland.package "hyprctl";
  zoom = pkgs.writeShellScript "shade-zoom" ''
    step="$1"
    exec ${hyprctl} eval "local c = hl.get_config('cursor:zoom_factor'); local s = $step; hl.config({ cursor = { zoom_factor = s == 0 and 1 or math.min(4, math.max(1, c + s)) } })"
  '';

  _bind = [
    "SUPER,Return,exec,${uwsm-app cfg.defaultTerminal}"
    "SUPER,B,exec,${uwsm-app cfg.defaultBrowser}"
    "SUPER,V,exec,pkill pwvucontrol || pwvucontrol"
    "SUPER,E,exec,${uwsm-app cfg.defaultFileManager}"
    "SUPER,C,exec,${uwsm-app "code"}"
    "SUPER,Backspace,exec,${hyprctl} reload;${pkgs.libnotify}/bin/notify-send 'Hyprland reloaded'"
    "SUPERCTRL,R,exec,systemctl --user restart shade-shell"
    "SUPERSHIFT,Q,exec,pkill Hyprland"
    "SUPERSHIFT,F,togglefloating,active"
    "SUPERSHIFT,G,togglegroup"
    "SUPER,G,changegroupactive,f"
    "SUPER,Q,killactive"
    "SUPER,P,pseudo"
    "SUPERSHIFT,T,shade-exact-pseudo"
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
    "SUPERCTRLALT,left,Move window into group on the left,moveintogroup,l"
    "SUPERCTRLALT,right,Move window into group on the right,moveintogroup,r"
    "SUPERCTRLALT,up,Move window into group above,moveintogroup,u"
    "SUPERCTRLALT,down,Move window into group below,moveintogroup,d"
    "SUPERCTRLALT,G,Move window out of group,moveoutofgroup"
    "SUPERALT,G,Lock active group,lockactivegroup,toggle"
    "SUPER,mouse_up,Zoom in,exec,${zoom} 0.25"
    "SUPER,mouse_down,Zoom out,exec,${zoom} -0.25"
    "SUPER,0,Reset zoom,exec,${zoom} 0"
  ];
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
  _splitBind = s: lib.splitString "," s;
  _keyOf = bindStr:
    let parts = _splitBind bindStr;
    in builtins.elemAt parts 1;
  _modsOf = bindStr:
    let parts = _splitBind bindStr;
    in [ (builtins.head parts) ];
  _tupleOf = bindStr: { mods = _modsOf bindStr; key = _keyOf bindStr; };
  _allBindLines = _bind ++ _bindd ++ _bindl ++ _bindle ++ _bindm ++ _binde;
  _keyDuplicates =
    let
      entries = map _tupleOf _allBindLines;
      isDupe = e: builtins.length (builtins.filter (x: x.mods == e.mods && x.key == e.key) entries) > 1;
      dupes = builtins.filter isDupe entries;
    in map (e: "${e.mods},${e.key}") dupes;
  _assertNoDupKeybinds =
    assert (_keyDuplicates == [ ])
      || throw "Duplicate Hyprland keybinds: ${builtins.concatStringsSep "; " _keyDuplicates}";
    [ ];
  quote = builtins.toJSON;
  keyMods = mods:
    let
      names = [ "SUPER" "SHIFT" "CONTROL" "CTRL" "ALT" ];
      values = [ "SUPER" "SHIFT" "CTRL" "CTRL" "ALT" ];
      replace = builtins.foldl' (acc: pair:
        builtins.replaceStrings [ pair.fst ] [ "${pair.snd}+" ] acc) mods
        (lib.zipLists names values);
    in lib.filter (x: x != "") (lib.splitString "+" replace);
  dispatcher = name: arg:
    let q = quote arg; table = field: value: "{ ${field} = ${quote value} }";
    in if name == "exec" then "hl.dsp.exec_cmd(${q})"
       else if name == "togglefloating" then "hl.dsp.window.float()"
       else if name == "togglegroup" then "hl.dsp.group.toggle()"
       else if name == "changegroupactive" then "hl.dsp.group.next()"
       else if name == "killactive" then "hl.dsp.window.close()"
       else if name == "pseudo" then "hl.dsp.window.pseudo()"
       else if name == "fullscreen" then "hl.dsp.window.fullscreen()"
       else if name == "togglespecialworkspace" then "hl.dsp.workspace.toggle_special(${q})"
       else if name == "movetoworkspace" then "hl.dsp.window.move(${table "workspace" arg})"
       else if name == "layoutmsg" then "hl.dsp.layout(${q})"
       else if name == "movefocus" then "hl.dsp.focus(${table "direction" ({l="left";r="right";u="up";d="down";}.${arg})})"
       else if name == "movewindow" then
         if lib.hasPrefix "mon:" arg then "hl.dsp.window.move(${table "monitor" (lib.removePrefix "mon:" arg)})"
         else "hl.dsp.window.move(${table "direction" ({l="left";r="right";u="up";d="down";}.${arg})})"
       else if name == "workspace" then "hl.dsp.focus(${table "workspace" arg})"
       else if name == "moveintogroup" then "hl.dsp.window.move(${table "into_group" ({l="left";r="right";u="up";d="down";}.${arg})})"
       else if name == "moveoutofgroup" then "hl.dsp.window.move({ out_of_group = true })"
       else if name == "lockactivegroup" then "hl.dsp.group.lock()"
       else if name == "resizeactive" then
         let xy = lib.splitString " " arg;
         in "hl.dsp.window.resize({ x = ${builtins.elemAt xy 0}, y = ${builtins.elemAt xy 1}, relative = true })"
       else if name == "resizewindow" then "hl.dsp.window.resize()"
       else if name == "shade-exact-pseudo" then
         ''function()
           hl.dsp.window.float({ action = "on" })()
           hl.dsp.window.resize({ x = 1920, y = 1080 })()
           hl.dsp.window.float({ action = "off" })()
           hl.dsp.window.pseudo()()
         end''
       else throw "Unmapped Hyprland dispatcher: ${name}";
  emit = flags: described: line:
    let
      parts = _splitBind line;
      mods = builtins.head parts;
      key = builtins.elemAt parts 1;
      offset = if described then 3 else 2;
      name = builtins.elemAt parts offset;
      arg = lib.concatStringsSep "," (lib.drop (offset + 1) parts);
      opts = flags ++ lib.optional described "description = ${quote (builtins.elemAt parts 2)}";
      action = if flags == [ "mouse = true" ] && name == "movewindow"
        then "hl.dsp.window.drag()" else dispatcher name arg;
    in "hl.bind(${quote (lib.concatStringsSep " + " (keyMods mods ++ [ key ]))}, ${action}, { ${lib.concatStringsSep ", " opts} })";
in
lib.mkIf (cfg.hyprland.enable && cfg.hyprland.binds.enable) {
  assertions = [{
    assertion = _assertNoDupKeybinds == [];
    message = "Hyprland key bindings must be unique.";
  }];
  programs.shade.desktop.hyprland.extraLuaConfig = lib.concatStringsSep "\n" (
    map (emit [] false) _bind ++ map (emit [] true) _bindd
    ++ map (emit [ "locked = true" ] false) _bindl
    ++ map (emit [ "locked = true" "repeating = true" ] false) _bindle
    ++ map (emit [ "mouse = true" ] false) _bindm
    ++ map (emit [ "repeating = true" ] false) _binde);
}
