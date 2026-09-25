{
  config,
  lib,
  ...
}:
let
  cfg = config.programs.shade.desktop.hyprland;

  # Type for a single monitor within a layout.
  monitorType = lib.types.submodule {
    options = {
      name = lib.mkOption {
        type = lib.types.str;
        description = "Monitor name as shown by hyprctl monitors.";
      };
      desc = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = ''
          EDID description (make model serial, as shown by
          `hyprctl monitors -j` `.description`) for stable matching
          across connector renames. Takes precedence over `name`
          when set.
        '';
      };
      resolution = lib.mkOption {
        type = lib.types.str;
        default = "preferred";
        description = "Resolution and refresh rate, e.g. 2560x1440@120.";
      };
      position = lib.mkOption {
        type = lib.types.str;
        default = "auto";
        description = "Position string, e.g. 0x0 or -1080x-240.";
      };
      scale = lib.mkOption {
        type = lib.types.oneOf [
          lib.types.int
          lib.types.float
        ];
        default = 1.0;
        description = "Monitor scale factor.";
      };
      transform = lib.mkOption {
        type = lib.types.int;
        default = 0;
        description = "Hyprland transform: 0=normal, 1=90°, 2=180°, 3=270°.";
      };
      vrr = lib.mkOption {
        type = lib.types.nullOr lib.types.int;
        default = null;
        description = "Variable refresh rate setting.";
      };
      disable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Disable this monitor in this layout.";
      };
    };
  };

in
{
  options.programs.shade.desktop.hyprland = {
    layouts = lib.mkOption {
      type = lib.types.attrsOf (
        lib.types.submodule {
          options = {
            monitors = lib.mkOption {
              type = lib.types.listOf monitorType;
              default = [ ];
              description = "Monitor configuration for this layout";
            };
            workspaces = lib.mkOption {
              type = lib.types.attrsOf lib.types.str;
              default = { };
              description = "Map workspace numbers/names to monitor names or EDID descriptions (desc: tokens are emitted for monitors that define desc)";
            };
            auto = lib.mkOption {
              type = lib.types.bool;
              default = true;
              description = "Include this layout in auto-selection";
            };
          };
        }
      );
      default = { };
      description = "Named monitor layouts used to seed the runtime-owned profile store.";
    };

    defaultLayout = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Preferred layout for initial runtime profile selection.";
    };
  };

  config = lib.mkMerge [
    (lib.mkIf cfg.enable {
      programs.hyprland.extraConfig = ''
        bind = SUPER, M, exec, shade-shell display-next
      '';
    })
    (lib.mkIf (cfg.enable && cfg.layouts != { }) {
      environment.etc."xdg/shade/initial-monitor-layouts.json".text = builtins.toJSON {
        layouts = cfg.layouts;
        defaultLayout = cfg.defaultLayout;
      };
    })
  ];
}
