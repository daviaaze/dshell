{ pkgs, lib, config, ... }:
let
  uwsm-app = app : "${pkgs.uwsm}/bin/uwsm-app -t service -- ${app}.desktop";
  cfg = config.programs.shade.desktop;
  gdbus = lib.getExe' pkgs.glib "gdbus";
  shade-action = action: "${gdbus} call --session --dest com.caioasmuniz.shade_shell --object-path /com/caioasmuniz/shade_shell --method org.gtk.Actions.Activate '${action}' '[]' '{}' >/dev/null 2>&1";

in
{
  programs.hyprland.settings = {
    bind = [
      "SUPER,Return,exec,${uwsm-app cfg.defaultTerminal}"
      "SUPER,B,exec,${uwsm-app cfg.defaultBrowser}"
      "SUPER,V,exec,pkill pwvucontrol || pwvucontrol"
      "SUPER,E,exec,${uwsm-app cfg.defaultFileManager}"
      "SUPER,C,exec,${uwsm-app "code"}"
      "SUPERSHIFT,V,exec,${shade-action "toggle-clipboard"}"

      "SUPERSHIFT,R,exec,hyprctl reload;${pkgs.libnotify}/bin/notify-send 'Hyprland reloaded'"
      "SUPERCTRL,R,exec,systemctl --user restart shade-shell"

      "SUPERSHIFT,Q,exec,pkill Hyprland"

      "SUPERSHIFT,F,togglefloating,active"
      "SUPERSHIFT,G,togglegroup"
      "SUPER,G,changegroupactive,f"
      "SUPER,Q,killactive"
      "SUPER,P,exec,hyprctl dispatch pseudo"
      "SUPERSHIFT,P,exec,hyprctl --batch 'dispatch togglefloating 1;dispatch resizeactive exact 1920 1080;dispatch togglefloating 0;dispatch pseudo'"
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

      ",XF86AudioMedia,exec,${pkgs.playerctl}/bin/playerctl play-pause"
      ",XF86AudioPlay,exec,${pkgs.playerctl}/bin/playerctl play-pause"
      ",XF86AudioStop,exec,${pkgs.playerctl}/bin/playerctl stop"
      ",XF86AudioPrev,exec,${pkgs.playerctl}/bin/playerctl previous"
      ",XF86AudioNext,exec,${pkgs.playerctl}/bin/playerctl next"

      "SUPER,left,movefocus,l"
      "SUPER,right,movefocus,r"
      "SUPER,up,movefocus,u"
      "SUPER,down,movefocus,d"
      "SUPERSHIFT,left,movewindow,l"
      "SUPERSHIFT,right,movewindow,r"
      "SUPERSHIFT,up,movewindow,u"
      "SUPERSHIFT,down,movewindow,d"
      "SUPERALT,up,workspace,m-1"
      "SUPERALT,down,workspace,m+1"
      "SUPERSHIFTALT,left,movewindow,mon:-1"
      "SUPERSHIFTALT,right,movewindow,mon:+1"
      "SUPERSHIFTALT,up,movetoworkspace,m-1"
      "SUPERSHIFTALT,down,movetoworkspace,m+1"

      "SUPER,j,movefocus,l"
      "SUPER,l,movefocus,r"
      "SUPER,i,movefocus,u"
      "SUPER,k,movefocus,d"
      "SUPERSHIFT,j,movewindow,l"
      "SUPERSHIFT,l,movewindow,r"
      "SUPERSHIFT,i,movewindow,u"
      "SUPERSHIFT,k,movewindow,d"
      "SUPERALT,i,workspace,m-1"
      "SUPERALT,k,workspace,m+1"
      "SUPERSHIFTALT,i,movetoworkspace,m-1"
      "SUPERSHIFTALT,k,movetoworkspace,m+1"
      ",XF86AudioMute,exec,wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"
      ",XF86AudioMicMute,exec,wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle"
    ];

    bindl = [
      ",XF86MonBrightnessUp,exec,${lib.getExe pkgs.brightnessctl} set +5%"
      ",XF86MonBrightnessDown,exec,${lib.getExe pkgs.brightnessctl} set 5%-"
    ];

    bindle = [
      ",XF86AudioRaiseVolume,exec,wpctl set-volume -l '1.0' @DEFAULT_AUDIO_SINK@ 5%+"
      ",XF86AudioLowerVolume,exec,wpctl set-volume -l '1.0' @DEFAULT_AUDIO_SINK@ 5%-"
    ];

    bindm = [
      "SUPER,mouse:272,movewindow"
      "SUPER,mouse:273,resizewindow"
    ];

    binde = [
      "SUPERCONTROL,left,resizeactive,-64 0"
      "SUPERCONTROL,right,resizeactive,64 0"
      "SUPERCONTROL,up,resizeactive,0 -64"
      "SUPERCONTROL,down,resizeactive,0 64"
      "SUPERCONTROL,j,resizeactive,-64 0"
      "SUPERCONTROL,l,resizeactive,64 0"
      "SUPERCONTROL,i,resizeactive,0 -64"
      "SUPERCONTROL,k,resizeactive,0 64"
    ];
  };
}
