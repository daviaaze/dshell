{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.shade.desktop.hyprland;
in
{
  imports = [
    ./binds.nix
  ];

  options.programs.shade.desktop.hyprland = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Enable hyprland compositor";
    };
    settings = lib.mkOption {
      type =
        with lib.types;
        let
          valueType =
            nullOr (oneOf [
              bool
              int
              float
              str
              path
              (attrsOf valueType)
              (listOf valueType)
            ])
            // {
              description = "Hyprland configuration value";
            };
        in
        valueType;
      default = { };
      description = ''
        Extra settings to hyprland.
      '';
    };
    binds.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Enable default binds to toggle the widgets in hyprland.
      '';
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      {
        programs.hyprland.settings = cfg.settings;
      }
      {
        services.power-profiles-daemon.enable = true;

        xdg.portal.extraPortals = [ pkgs.xdg-desktop-portal-hyprland ];
        environment.sessionVariables = {
          MOZ_ENABLE_WAYLAND = "1";
          NIXOS_OZONE_WL = "1";
          SDL_VIDEODRIVER = "wayland";
        };

        programs.hyprland = {
          enable = true;
          withUWSM = true;
          package = pkgs.hyprland;
          portalPackage = pkgs.xdg-desktop-portal-hyprland;

          settings = {
            monitor = [
              ", preferred, auto-left, auto"
            ];

            workspace = [
              "special:scratchpad, on-created-empty: [pseudo; size 1920 1080] ghostty"
            ];

            input = {
              kb_layout = "us";
              follow_mouse = 1;
              accel_profile = "flat";
              touchpad = {
                natural_scroll = false;
                scroll_factor = 0.5;
              };
            };

            general = {
              gaps_in = 2;
              gaps_out = 4;
              float_gaps = 4;
              border_size = 2;
              "col.active_border" = "0xff3584e4";
              "col.inactive_border" = "0xff9a9996";
              resize_on_border = true;
              hover_icon_on_border = true;
              snap = {
                enabled = true;
                respect_gaps = true;
              };
            };

            group = {
              "col.border_active" = "0xff3584e4";
              "col.border_inactive" = "0xff9a9996";
            };

            gesture = [
              "3, vertical, workspace"
              "3, swipe, mod: SUPER, move"
              "3, swipe, mod: SUPERCONTROL, resize"
              "4, vertical, special, scratchpad"
            ];

            decoration = {
              rounding = 12;
              blur = {
                enabled = true;
                passes = 2;
                special = true;
                popups = true;
              };
              shadow = {
                enabled = true;
                range = 4;
                render_power = 4;
              };
            };

            animations = {
              enabled = true;
              workspace_wraparound = true;
            };

            animation = [
              "windows,1,5,default,slide"
              "layers,1,5,default,slide"
              "border,1,10,default"
              "fadePopups,1,5,default"
              "workspaces,1,5,default,slidevert"
              "monitorAdded,1,5,default"
            ];

            binds = {
              hide_special_on_workspace_change = true;
            };

            misc = {
              animate_manual_resizes = true;
              animate_mouse_windowdragging = false;
              vfr = true;
              vrr = 1;
              enable_swallow = true;
              swallow_regex = "";
              layers_hog_keyboard_focus = true;
              focus_on_activate = true;
              disable_splash_rendering = true;
              disable_hyprland_logo = true;
            };

            xwayland = {
              force_zero_scaling = true;
              create_abstract_socket = true;
            };

            dwindle = {
              pseudotile = 1;
              preserve_split = true;
            };

            layerrule = [
              "no_anim on, match:namespace selection"
            ];

            exec = [
              "hyprctl setcursor Adwaita 24"
            ];
          };
        };
      }
      (lib.mkIf cfg.binds.enable {
        programs.hyprland.extraConfig = ''
          bind=SUPER,Space,exec, shade-shell toggle applauncher
          bind=SUPER,n,exec, shade-shell toggle quicksettings
          bind=SUPER,w,exec, shade-shell toggle bar

          gesture= 3,right, dispatcher,exec, shade-shell toggle applauncher
          gesture= 3,left, dispatcher,exec, shade-shell toggle quicksettings
        '';
      })
    ]
  );
}
