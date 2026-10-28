{
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
    ./expo.nix
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

      windowRules =
        lib.optionals cfg.windowRules.enable [
          "float on, match:class ${floatClassRe}"
          "center on, match:class ${floatClassRe}"
          "float on, match:title ${dialogTitleRe}"
          "center on, match:title ${dialogTitleRe}"
          "float on, ${pip}"
          "pin on, ${pip}"
          "keep_aspect_ratio on, ${pip}"
          "size 480 270, ${pip}"
          "move (monitor_w-window_w-${toString gapsOut}) (monitor_h-window_h-${toString gapsOut}), ${pip}"
          "idle_inhibit fullscreen, match:class .*"
          # Apps maximizing themselves fight the tiling layout.
          "suppress_event maximize, match:class .*"
        ]
        ++ lib.optionals cfg.smartGaps [
          "border_size 0, match:float false, match:workspace w[tv1]"
          "rounding 0, match:float false, match:workspace w[tv1]"
        ]
        ++ cfg.extraWindowRules;

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
          preserve_split = true;
        };

        exec = [
          "hyprctl setcursor Adwaita 24"
        ];
      };
    in
    lib.mkMerge [
      {
        assertions = lib.mkIf (cfg.defaultLayout != null) [
          {
            assertion = cfg.layouts ? ${cfg.defaultLayout};
            message = "programs.shade.desktop.hyprland.defaultLayout '${cfg.defaultLayout}' is not defined in layouts";
          }
        ];

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
            pkgs.xdg-desktop-portal-hyprland
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
        programs.uwsm.waylandCompositors.hyprland = {
          prettyName = "Hyprland";
          comment = "Hyprland compositor managed by UWSM";
          binPath = "${
            pkgs.writeShellScriptBin "Hyprland" ''
              exec /run/current-system/sw/bin/start-hyprland "$@"
            ''
          }/bin/Hyprland";
        };

        programs.hyprland = {
          enable = true;
          withUWSM = true;
          package = pkgs.hyprland;
          portalPackage = pkgs.xdg-desktop-portal-hyprland;
        };
      }
      (lib.mkIf cfg.binds.enable {
        programs.hyprland.extraConfig = "";

        # Runtime introspection for keybinds. GNOME and KDE ship a
        # Shortcuts panel; this gives shade-shell a terminal equivalent.
        # Parses the generated hyprland.conf, prints a table, and flags
        # duplicate (mod,key) pairs.
        environment.systemPackages = [
          (pkgs.writeShellScriptBin "shade-keybinds" ''
            # shade-keybinds — print the active Hyprland bind table and
            # flag duplicates. Parses the generated hyprland.conf instead
            # of the Nix source, so it reflects what Hyprland actually
            # loaded (user overrides included).
            #
            # Usage: shade-keybinds [--json|--help]

            set -euo pipefail

            HYPR_CONF="$HOME/.config/hyprland/hyprland.conf"
            [ -e "$HYPR_CONF" ] || HYPR_CONF="''${XDG_CONFIG_HOME:-$HOME/.config}/hyprland/hyprland.conf"

            print_help() {
              cat <<'HELP'
            Usage: shade-keybinds [--json|--help]

            Print the active Hyprland keybind table and flag conflicts.

            Options:
              --json     Output JSON (array of {type,mods,key,dispatcher,arg})
              --help     Show this help

            Examples:
              shade-keybinds              # human-readable table
              shade-keybinds --json       # machine-readable
            HELP
            }

            emit_json() {
              local first=true
              echo "["
              while IFS='|' read -r type mods key dispatcher arg; do
                $first || echo ","
                first=false
                # Escape for JSON
                mods=$(printf '%s' "$mods" | sed 's/"/\\"/g')
                key=$(printf '%s' "$key" | sed 's/"/\\"/g')
                dispatcher=$(printf '%s' "$dispatcher" | sed 's/"/\\"/g')
                arg=$(printf '%s' "$arg" | sed 's/"/\\"/g')
                printf '  {"type":"%s","mods":"%s","key":"%s","dispatcher":"%s","arg":"%s"}' \
                  "$type" "$mods" "$key" "$dispatcher" "$arg"
              done < <(parse)
              echo ""
              echo "]"
            }

            # Parse hyprland.conf bind lines. Output: type|mods|key|dispatcher|arg
            parse() {
              [ -e "$HYPR_CONF" ] || {
                echo "shade-keybinds: $HYPR_CONF not found" >&2
                exit 1
              }

              awk '
              /^bindl?[e]?=/ { sub(/^bindl?[e]?/, ""); typ=$0 }
              /^bindm=/          { typ="bindm" }
              /^bindl=/          { typ="bindl" }
              /^bindle=/         { typ="bindle" }
              /^binde=/          { typ="binde" }
              /^bind=/           { typ="bind" }

              # Collect lines that belong to an array
              /^bind/ { in_array=1; line=$0; next }
              in_array && /^[[:space:]]+"/ {
                line = line "\n" $0
                if (/\"[[:space:]]*$/) {
                  # End of one bind entry — extract the comma-separated value
                  gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
                  gsub(/\n/, "", line)
                  gsub(/^[[:space:]]*"|"[[:space:]]*$/, "", line)
                  # Now line is the raw comma list
                  # Split into fields
                  n = split(line, f, ",")
                  if (n >= 4) {
                    # Detect optional --locked flag
                    offset = 1
                    if (f[1] == "--locked") offset = 2
                    key = f[offset+1]
                    dispatcher = f[offset+2]
                    arg = ""
                    for (i = offset+3; i <= n; i++) {
                      if (arg != "") arg = arg ","
                      arg = arg f[i]
                    }
                    mods = f[offset]
                    # Print type|mods|key|dispatcher|arg
                    printf "%s|%s|%s|%s|%s\n", typ, mods, key, dispatcher, arg
                  }
                  line = ""
                }
              }
              in_array && (/^[[:space:]]*\]/ || /^[^[:space:]]/) { in_array=0 }
              ' "$HYPR_CONF"
            }

            # Human-readable table with duplicate detection
            print_table() {
              # Build associative array of (mods,key) -> count
              declare -A seen
              while IFS='|' read -r type mods key dispatcher arg; do
                pair="$mods,$key"
                seen["$pair"]=$(( ''${seen["$pair"]:-0} + 1 ))
              done < <(parse)

              printf "%-8s %-16s %-20s %-20s %s\n" TYPE MODS KEY DISPATCHER ARG
              printf "%-8s %-16s %-20s %-20s %s\n" ---- ---- ---- ---------- ---
              while IFS='|' read -r type mods key dispatcher arg; do
                pair="$mods,$key"
                marker=""
                if [ "''${seen["$pair"]}" -gt 1 ]; then
                  marker="  ⚠ CONFLICT"
                fi
                printf "%-8s %-16s %-20s %-20s %s%s\n" "$type" "$mods" "$key" "$dispatcher" "$arg" "$marker"
              done < <(parse)

              # Summary
              dupes=0
              for k in "''${!seen[@]}"; do
                [ "''${seen[$k]}" -gt 1 ] && dupes=$((dupes+1))
              done
              echo ""
              if [ "$dupes" -gt 0 ]; then
                echo "⚠ $dupes duplicate keybind pair(s) detected (last one wins in Hyprland)"
              else
                echo "✓ No keybind conflicts"
              fi
            }

            # Main
            case "''${1:-}" in
              --help|-h) print_help ;;
              --json)    emit_json ;;
              *)         print_table ;;
            esac
          '')
        ];
      })
    ]
  );
}
