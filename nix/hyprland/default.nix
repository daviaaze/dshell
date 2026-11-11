{
  shadeHyprland,
  xdpHyprland,
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.shade.desktop.hyprland;
  desktopCfg = config.programs.shade.desktop;

in
{
  imports = [
    ./binds.nix
    ./layouts.nix
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
        Extra settings to hyprland. Merged on top of defaults using
        recursiveUpdate — list values replace the default entirely
        rather than concatenating.
      '';
    };
    extraLuaConfig = lib.mkOption {
      type = lib.types.lines;
      default = "";
      description = ''
        Native Hyprland Lua appended verbatim after the Shade-rendered
        configuration. It is a read-only startup escape hatch: Shade neither
        edits nor introspects it. Everything Nix declares (settings, binds,
        window rules, layouts) reaches the compositor through the compositor
        seed instead, so custom Lua is only needed for what the seed cannot
        express.
      '';
    };
    workspace = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [
        "special:scratchpad, on-created-empty: [pseudo; size 1920 1080] ${lib.getExe pkgs.uwsm} app -- ${desktopCfg.defaultTerminal}"
      ];
      defaultText = lib.literalExpression ''
        [
                "special:scratchpad, on-created-empty: ..."
              ]'';
      description = ''
        Workspace rules for Hyprland. Each entry is a workspace rule string.
        Default creates a scratchpad terminal. Add monitor-specific rules
        to pin workspaces to a monitor, e.g.:
          "1, monitor:eDP-1, default:true"
          "2, monitor:DP-1, default:true"
      '';
    };
    softwareCursor = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Render the cursor in software (cursor:no_hardware_cursors). Only
        needed on GPUs/drivers with broken hardware cursor planes.
      '';
    };
    hideIdleCursor = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Hide the cursor while typing and after 5 seconds of inactivity.";
    };
    smartGaps = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Remove gaps, border and rounding when a workspace has a single
        tiled window.
      '';
    };
    windowRules = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Default window rules: float utility dialogs (audio, network,
          bluetooth, polkit, file choosers), Picture-in-Picture placement,
          idle inhibit on fullscreen and ignoring app maximize requests.
        '';
      };
    };
    extraWindowRules = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [ "float on, match:class ^(org.gnome.Calculator)$" ];
      description = "Extra Hyprland windowrule strings appended after the defaults.";
    };
    animations.preset = lib.mkOption {
      type = lib.types.enum [
        "adwaita"
        "minimal"
        "off"
      ];
      default = "adwaita";
      description = ''
        Animation style. "adwaita" mimics libadwaita curves, "minimal" keeps
        only short fades (reduced motion), "off" disables animations.
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
    let
      gapsOut = 4;

      # Utility dialogs that are unusable when tiled full-height.
      floatClasses = [
        "com\\.saivert\\.pwvucontrol"
        "polkit-gnome-authentication-agent-1"
        "nm-connection-editor"
        "\\.?blueman-manager(-wrapped)?"
        "xdg-desktop-portal-gtk"
      ];
      dialogTitles = [
        "Open File"
        "Open Files"
        "Open Folder"
        "Save File"
        "Save As"
        "Select a File"
        "Abrir arquivo"
        "Abrir arquivos"
        "Abrir pasta"
        "Salvar arquivo"
        "Salvar como"
        "Selecionar arquivo"
      ];
      floatClassRe = "^(${lib.concatStringsSep "|" floatClasses})$";
      dialogTitleRe = "^(${lib.concatStringsSep "|" dialogTitles})(.*)$";
      pip = "match:title ^(Picture-in-Picture)$";

      # Built-in window rules carry stable ids: the compositor seed keeps them so
      # user overrides stay attached to the same rule across rebuilds.
      defaultWindowRules =
        lib.optionals cfg.windowRules.enable [
          {
            id = "float-utility-apps";
            rule = "float on, match:class ${floatClassRe}";
          }
          {
            id = "center-utility-apps";
            rule = "center on, match:class ${floatClassRe}";
          }
          {
            id = "float-file-dialogs";
            rule = "float on, match:title ${dialogTitleRe}";
          }
          {
            id = "center-file-dialogs";
            rule = "center on, match:title ${dialogTitleRe}";
          }
          {
            id = "pip-float";
            rule = "float on, ${pip}";
          }
          {
            id = "pip-pin";
            rule = "pin on, ${pip}";
          }
          {
            id = "pip-keep-aspect-ratio";
            rule = "keep_aspect_ratio on, ${pip}";
          }
          {
            id = "pip-size";
            rule = "size 480 270, ${pip}";
          }
          {
            id = "pip-corner";
            rule = "move (monitor_w-window_w-${toString gapsOut}) (monitor_h-window_h-${toString gapsOut}), ${pip}";
          }
          {
            id = "idle-inhibit-fullscreen";
            rule = "idle_inhibit fullscreen, match:class .*";
          }
          # Apps maximizing themselves fight the tiling layout.
          {
            id = "suppress-maximize";
            rule = "suppress_event maximize, match:class .*";
          }
        ]
        ++ lib.optionals cfg.smartGaps [
          {
            id = "smart-gaps-border";
            rule = "border_size 0, match:float false, match:workspace w[tv1]";
          }
          {
            id = "smart-gaps-rounding";
            rule = "rounding 0, match:float false, match:workspace w[tv1]";
          }
        ];

      windowRules = map (entry: entry.rule) defaultWindowRules ++ cfg.extraWindowRules;

      smartGapsWorkspaces = lib.optionals cfg.smartGaps [
        "w[tv1], gapsout:0, gapsin:0"
      ];

      animationPresets = {
        adwaita = [
          "windowsIn, 1, 4, emphasized, popin 85%"
          "windowsOut, 1, 3, adw, popin 90%"
          "windowsMove, 1, 4, emphasized, slide"
          "fade, 1, 3, adw"
          "border, 1, 6, adw"
          "layersIn, 1, 3, emphasized, fade"
          "layersOut, 1, 2, adw, fade"
          "fadePopups, 1, 3, adw"
          "workspaces, 1, 4, emphasized, slidefadevert 15%"
          "specialWorkspace, 1, 4, emphasized, slidefadevert 20%"
          "monitorAdded, 1, 5, adw"
        ];
        # Reduced motion: no slides or popins, only short fades.
        minimal = [
          "windows, 0"
          "border, 0"
          "fade, 1, 2, adw"
          "layers, 1, 2, adw, fade"
          "workspaces, 1, 2, adw, fade"
        ];
        off = [ ];
      };

      # Default settings — kept separate so cfg.settings can override
      # specific keys via recursiveUpdate (list values replace entirely
      # rather than concatenating).
      defaultSettings = {
        monitor = [
          ", preferred, auto, 1"
        ];

        cursor = {
          no_hardware_cursors = cfg.softwareCursor;
          hide_on_key_press = cfg.hideIdleCursor;
          inactive_timeout = if cfg.hideIdleCursor then 5 else 0;
        };

        windowrule = windowRules;

        render = {
          # Auto: only scan out directly for fullscreen game-like content.
          direct_scanout = 2;
        };

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
          gaps_out = gapsOut;
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
          groupbar = {
            font_size = 11;
            gradients = false;
            rounding = 6;
            "col.active" = "0xff3584e4";
            "col.inactive" = "0xff9a9996";
          };
        };

        gesture = [
          "3, vertical, workspace"
          "3, swipe, mod: SUPER, move"
          "3, swipe, mod: SUPERCONTROL, resize"
          "4, vertical, special, scratchpad"
          "4, pinch, fullscreen"
        ];

        gestures = {
          workspace_swipe_forever = true;
        };

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
          enabled = cfg.animations.preset != "off";
          workspace_wraparound = false;
        };

        bezier = [
          # libadwaita's default ease-out
          "adw, 0.25, 0.1, 0.25, 1"
          "emphasized, 0.05, 0.7, 0.1, 1"
        ];

        animation = animationPresets.${cfg.animations.preset};

        binds = {
          hide_special_on_workspace_change = true;
          workspace_back_and_forth = true;
          allow_workspace_cycles = true;
        };

        misc = {
          # A crashed locker leaves the compositor locked; its replacement must be able to recover.
          allow_session_lock_restore = true;
          animate_manual_resizes = true;
          animate_mouse_windowdragging = false;
          vrr = 1;
          enable_swallow = true;
          swallow_regex = "^(${lib.escapeRegex desktopCfg.defaultTerminal})$";
          focus_on_activate = true;
          disable_splash_rendering = true;
          disable_hyprland_logo = true;
        };

        layers = {
          layers_hog_keyboard_focus = true;
        };

        xwayland = {
          force_zero_scaling = true;
          create_abstract_socket = true;
        };

        dwindle = {
          preserve_split = true;
        };

        # Hyprland 0.57 runs top-level Lua exec_cmd calls while the config loads,
        # before the IPC socket exists, so `hyprctl setcursor` silently failed on
        # every login. Environment values are read when the pointer is created.
        env = [
          "XCURSOR_THEME,Adwaita"
          "XCURSOR_SIZE,24"
          "HYPRCURSOR_THEME,Adwaita"
          "HYPRCURSOR_SIZE,24"
        ];
      };

      # Everything Nix resolved, as data. Shade renders the Lua from this at login.
      compositorSeed = import ./seed.nix {
        inherit lib;
        settings = config.programs.hyprland.settings;
        plugins = config.programs.hyprland.plugins;
        binds = cfg.binds.specs;
        inherit (cfg) layouts defaultLayout extraLuaConfig;
        windowRuleIds = defaultWindowRules;
      };
    in
    lib.mkMerge [
      {
        assertions =
          lib.optionals (cfg.defaultLayout != null) [
            {
              assertion = cfg.layouts ? ${cfg.defaultLayout};
              message = "programs.shade.desktop.hyprland.defaultLayout '${cfg.defaultLayout}' is not defined in layouts";
            }
          ]
          ++ [
            {
              assertion = config.programs.hyprland.extraConfig == "";
              message = "Hyprland 0.57 requires Lua: move programs.hyprland.extraConfig to programs.shade.desktop.hyprland.extraLuaConfig.";
            }
          ];

        environment.etc."xdg/hypr/hyprland.conf".enable = false;
        # Nix only serialises data; the launcher below renders the Lua from this
        # seed (plus the user's compositor.json) before the compositor starts.
        environment.etc."xdg/shade/compositor-seed.json".text = builtins.toJSON compositorSeed;

        programs.hyprland.settings = lib.recursiveUpdate defaultSettings (
          cfg.settings
          // {
            # Merge workspace rules: cfg.workspace replaces the default
            # scratchpad rule entirely, or you can include it in your list.
            workspace = cfg.workspace ++ smartGapsWorkspaces;
          }
        );
      }
      {
        services.power-profiles-daemon.enable = true;

        # gvfs is required for the default file manager (Nautilus) to show
        # disk sizes, mount volumes, and provide trash/computer/network
        # locations in the sidebar.
        services.gvfs.enable = true;

        xdg.portal = {
          enable = lib.mkDefault true;
          extraPortals = [
            pkgs.xdg-desktop-portal-gtk
            xdpHyprland
            pkgs.xdg-desktop-portal-wlr
          ];
          config = {
            common = {
              default = [
                "hyprland"
                "gtk"
              ];
              "org.freedesktop.impl.portal.Screencast" = "hyprland";
              "org.freedesktop.impl.portal.Screenshot" = "hyprland";
              "org.freedesktop.impl.portal.Settings" = "gtk";
            };
          };
        };

        environment.sessionVariables = {
          MOZ_ENABLE_WAYLAND = "1";
          NIXOS_OZONE_WL = "1";
          SDL_VIDEODRIVER = "wayland";
        };

        # UWSM derives XDG_CURRENT_DESKTOP from the executable name, so pointing
        # it straight at start-hyprland exports "start-hyprland" and Hyprland
        # shows its "XDG_CURRENT_DESKTOP managed externally" warning overlay on
        # every login (it requires exactly "Hyprland"). A launcher *named*
        # Hyprland keeps start-hyprland (watchdog) while yielding the right
        # desktop name and UWSM's Hyprland plugin. It still execs the system
        # start-hyprland to avoid version skew with the installed compositor.
        #
        # Before exec'ing it the launcher runs `shade-shell compositor render`,
        # which merges the seed with the user's overrides, writes the effective
        # Lua under $XDG_RUNTIME_DIR/shade and prints that path.
        programs.uwsm.waylandCompositors.hyprland = {
          prettyName = "Hyprland";
          comment = "Hyprland compositor managed by UWSM";
          binPath = "${pkgs.writeShellScriptBin "Hyprland" ''
            set -eu
            # A failed render aborts the session: starting the compositor without
            # Shade's configuration would silently drop every binding.
            HYPRLAND_CONFIG="$(${lib.getExe config.programs.shade.package} compositor render)"
            export HYPRLAND_CONFIG
            exec ${lib.getExe' config.programs.hyprland.package "start-hyprland"} "$@"
          ''}/bin/Hyprland";
        };

        programs.hyprland = {
          enable = true;
          withUWSM = true;
          package = shadeHyprland;
          portalPackage = xdpHyprland;
        };
      }
      (lib.mkIf cfg.binds.enable {
        # Introspect the active compositor rather than parsing source files.
        environment.systemPackages = [
          (pkgs.writeShellScriptBin "shade-keybinds" ''
            exec ${lib.getExe pkgs.python3} - "$@" <<'PY'
            import collections
            import json
            import subprocess
            import sys

            if len(sys.argv) > 1 and sys.argv[1] in ("--help", "-h"):
                print("Usage: shade-keybinds [--json|--help]")
                print("Print active Hyprland keybinds and flag duplicate (submap, modifiers, key) pairs.")
                raise SystemExit(0)
            binds = json.loads(subprocess.check_output(
                ["${lib.getExe' config.programs.hyprland.package "hyprctl"}", "binds", "-j"],
                text=True,
            ))
            if len(sys.argv) > 1 and sys.argv[1] == "--json":
                print(json.dumps(binds, ensure_ascii=False))
                raise SystemExit(0)
            def pair(bind):
                return (bind.get("submap", ""), bind.get("modmask", 0),
                        bind.get("key") or bind.get("keycode", 0))
            counts = collections.Counter(map(pair, binds))
            print(f"{'MODS':<8} {'KEY':<22} {'DISPATCHER':<32} DESCRIPTION")
            for bind in binds:
                conflict = " [CONFLICT]" if counts[pair(bind)] > 1 else ""
                print(f"{bind.get('modmask', 0)!s:<8} "
                      f"{bind.get('key') or bind.get('keycode', 0)!s:<22} "
                      f'{bind.get("dispatcher", ""):<32} '
                      f'{bind.get("description", "")}{conflict}')
            duplicates = sum(count > 1 for count in counts.values())
            print(f"\n{duplicates} duplicate keybind pair(s)")
            PY
          '')
        ];
      })
    ]
  );
}
