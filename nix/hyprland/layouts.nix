{
  config,
  lib,
  pkgs,
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
        type = lib.types.oneOf [ lib.types.int lib.types.float ];
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

  layoutsJson = pkgs.writeText "shade-layouts.json" (builtins.toJSON cfg.layouts);

  # jq prelude: parse `get_current_monitors` output (name<TAB>description
  # lines) into $mons. Interpolated into the shade-layout jq programs at
  # build time (the programs are single-quoted, so a shell variable would
  # never expand).
  jqMonsPrelude = ''($current | split("\n") | map(select(. != "") | split("\t") | {name: .[0], description: .[1]})) as $mons'';

  shade-layout = pkgs.writeShellScriptBin "shade-layout" ''
    set -euo pipefail

    LAYOUTS_FILE="${layoutsJson}"
    HYPRLAND_SIGNATURE="''${HYPRLAND_INSTANCE_SIGNATURE:-}"

    if [ -z "$HYPRLAND_SIGNATURE" ]; then
      echo "shade-layout: HYPRLAND_INSTANCE_SIGNATURE not set" >&2
      exit 1
    fi

    usage() {
      cat <<EOF
    Usage: shade-layout <command>

    Commands:
      list              List available layouts
      apply <name>      Apply layout by name
      auto              Auto-select layout based on connected monitors
      next              Cycle to next layout
      prev              Cycle to previous layout
    EOF
    }

    list_layouts() {
      ${lib.getExe pkgs.jq} -r 'keys[]' "$LAYOUTS_FILE"
    }

    get_current_monitors() {
      hyprctl monitors -j | ${lib.getExe pkgs.jq} -r '.[] | "\(.name)\t\(.description)"'
    }

    find_best_layout() {
      local current
      current=$(get_current_monitors)
      ${lib.getExe pkgs.jq} -r --arg current "$current" '
        ${jqMonsPrelude}
        | to_entries
        | map({ name: .key, auto: (.value.auto // true),
                monitors: ([.value.monitors[] | (.desc // .name)] | sort) })
        | map(select(.auto))
        | map(select(.monitors | all(. as $t | any($mons[]; .name == $t or .description == $t))))
        | sort_by(-(.monitors | length))
        | .[0].name // empty
      ' "$LAYOUTS_FILE"
    }

    apply_layout() {
      local name="$1"
      local monitors
      monitors=$(${lib.getExe pkgs.jq} -r --arg name "$name" '.[$name].monitors // empty' "$LAYOUTS_FILE")
      if [ -z "$monitors" ] || [ "$monitors" = "null" ]; then
        echo "shade-layout: layout '$name' not found" >&2
        exit 1
      fi

      ${lib.getExe pkgs.jq} -r --arg name "$name" '
        def token: if .desc then "desc:\(.desc)" else .name end;
        .[$name].monitors[]
        | if .disable then "monitor \(token),disable"
          else
            "monitor \(token),\(.resolution // "preferred"),\(.position // "auto"),\(.scale // 1)"
            + (if .transform != 0 then ",transform,\(.transform)" else "" end)
            + (if .vrr != null then ",vrr,\(.vrr)" else "" end)
          end
      ' "$LAYOUTS_FILE" | while IFS= read -r line; do
        hyprctl keyword "$line"
      done

      ${lib.getExe pkgs.jq} -r --arg name "$name" '
        .[$name] as $layout
        | ($layout.monitors | map(. as $m
            | [{ key: $m.name, token: (if $m.desc then "desc:\($m.desc)" else $m.name end) }]
              + (if $m.desc then [{ key: $m.desc, token: "desc:\($m.desc)" }] else [] end)
          ) | add // []) as $tokens
        | ($layout.workspaces // {}) | to_entries[]
        | .key as $k | .value as $v
        | (($tokens | map(select(.key == $v)) | .[0] // {token: null}) | .token // $v) as $tok
        | "workspace \($k),monitor:\($tok),default:true"
      ' "$LAYOUTS_FILE" | while IFS= read -r line; do
        hyprctl keyword "$line"
      done

      ${lib.getExe pkgs.jq} -r --arg name "$name" '
        .[$name] as $layout
        | ($layout.monitors | map(. as $m
            | [{ key: $m.name, token: (if $m.desc then "desc:\($m.desc)" else $m.name end) }]
              + (if $m.desc then [{ key: $m.desc, token: "desc:\($m.desc)" }] else [] end)
          ) | add // []) as $tokens
        | ($layout.workspaces // {}) | to_entries[]
        | .key as $k | .value as $v
        | (($tokens | map(select(.key == $v)) | .[0] // {token: null}) | .token // $v) as $tok
        | "\($k) \($tok)"
      ' "$LAYOUTS_FILE" | while IFS= read -r ws mon; do
        hyprctl dispatch moveworkspacetomonitor "$ws $mon" > /dev/null 2>&1 || true
      done

      ${lib.getExe pkgs.libnotify} "shade-layout" -u normal "Layout: $name" || true
    }

    cycle() {
      local direction="$1"
      local current next
      current=$(${lib.getExe pkgs.jq} -r --arg current "$(get_current_monitors)" '
        ${jqMonsPrelude}
        | to_entries
        | map({ name: .key,
                monitors: ([.value.monitors[] | (.desc // .name)] | sort) })
        | map(select((.monitors | length) == ($mons | length)
            and (.monitors | all(. as $t | any($mons[]; .name == $t or .description == $t)))))
        | .[0].name // empty
      ' "$LAYOUTS_FILE")
      if [ -z "$current" ]; then
        current=$(list_layouts | head -n1)
      fi
      next=$(${lib.getExe pkgs.jq} -r --arg current "$current" --arg dir "$direction" '
        keys as $names
        | ($names | index($current)) as $idx
        | if $idx == null then $names[0]
          elif $dir == "next" then $names[(($idx + 1) % ($names | length))]
          else $names[(($idx - 1 + ($names | length)) % ($names | length))]
          end
      ' "$LAYOUTS_FILE")
      apply_layout "$next"
    }

    case "''${1:-}" in
      list) list_layouts ;;
      apply) apply_layout "''${2:-}" ;;
      auto)
        best=$(find_best_layout)
        if [ -n "$best" ]; then
          apply_layout "$best"
        else
          echo "shade-layout: no matching layout found" >&2
          exit 1
        fi
        ;;
      next) cycle next ;;
      prev) cycle prev ;;
      *) usage; exit 1 ;;
    esac
  '';
in
{
  options.programs.shade.desktop.hyprland = {
    layouts = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
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
      });
      default = { };
      description = ''
        Named monitor layouts. The layout selected by <option>defaultLayout</option>
        is merged into the static Hyprland config. Other layouts can be applied at
        runtime with the <command>shade-layout</command> command.
      '';
    };

    defaultLayout = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Layout to apply in the static Hyprland config";
    };

    autoSwitch = {
      enable = lib.mkEnableOption "automatic layout switching when monitors are connected or disconnected";
    };
  };

  config = lib.mkIf (cfg.enable && cfg.layouts != { }) (
    let
      shade-layout-auto = pkgs.writeShellScriptBin "shade-layout-auto" ''
        set -euo pipefail

        SHADE_LAYOUT="${lib.getExe shade-layout}"
        HYPRL_DIR="''${XDG_RUNTIME_DIR:-/run/user/$(id - u)}/hypr"

        find_socket() {
          local sig
          sig=$(ls -1 "$HYPRL_DIR" 2>/dev/null | head -n1)
          if [ -z "$sig" ]; then
            echo "shade-layout-auto: no Hyprland instance found" >&2
            exit 1
          fi
          echo "$HYPRL_DIR/$sig/.socket2.sock"
        }

        apply() {
          "$SHADE_LAYOUT" auto || true
        }

        # Apply once on startup.
        apply

        # Listen for monitor add/remove events and re-apply.
        exec ${lib.getExe pkgs.socat} -u UNIX-CONNECT:"$(find_socket)" - | while IFS= read -r line; do
          case "$line" in
            monitoradded*|monitorremoved*)
              apply
              ;;
          esac
        done
      '';
    in
    lib.mkMerge [
      {
        # Keybind to cycle layouts at runtime.
        programs.hyprland.extraConfig = ''
          bind = SUPER, M, exec, shade-layout next
        '';
      }
      {
        environment.systemPackages = [ shade-layout shade-layout-auto ];
      }
      (lib.mkIf cfg.autoSwitch.enable {
        systemd.user.services.shade-layout-auto = {
          description = "Shade automatic monitor layout switcher";
          partOf = [ "graphical-session.target" ];
          after = [ "graphical-session.target" ];
          wantedBy = [ "graphical-session.target" ];
          serviceConfig = {
            ExecStart = lib.getExe shade-layout-auto;
            Restart = "on-failure";
            RestartSec = 2;
          };
        };
      })
    ]
  );
}
