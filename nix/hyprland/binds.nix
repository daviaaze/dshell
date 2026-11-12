{
  pkgs,
  lib,
  config,
  ...
}:
let
  cfg = config.programs.shade.desktop;
  # Bindings are data (BindSpec) in the compositor seed; the TypeScript model
  # renders them as compositor-native dispatchers. Shell panels keep the exact
  # guarded D-Bus command below, and external commands stay plain commands, so
  # existing shell helpers and failure notifications are preserved.
  shade-action =
    action:
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
  playerctl = "${pkgs.playerctl}/bin/playerctl";

  categories = {
    apps = "Abrir aplicativos";
    windows = "Controles de janela";
    windowFocus = "Navegação entre janelas";
    workspaces = "Navegação entre espaços de trabalho";
    layout = "Layout";
    system = "Sistema";
    shade = "Shade";
    media = "Mídia e brilho";
    zoom = "Zoom";
  };

  flagsLocked = {
    locked = true;
  };
  flagsLockedRepeating = {
    locked = true;
    repeating = true;
  };
  flagsRepeating = {
    repeating = true;
  };
  flagsMouse = {
    mouse = true;
  };

  # A chord is authored as modifiers plus key; Hyprland's Lua API takes "SUPER + SHIFT + Q".
  bind =
    {
      id,
      mods ? [ ],
      key,
      title,
      category,
      action,
      flags ? null,
    }:
    {
      inherit
        id
        title
        category
        action
        ;
      keys = lib.concatStringsSep " + " (mods ++ [ key ]);
    }
    // lib.optionalAttrs (flags != null) { inherit flags; };

  dispatch =
    name: args:
    {
      type = "hypr-dispatch";
      inherit name;
    }
    // lib.optionalAttrs (args != null) { inherit args; };
  launch = desktopId: {
    type = "launch-app";
    inherit desktopId;
  };
  run = command: {
    type = "command";
    inherit command;
  };
  shell = name: command: {
    type = "shell-action";
    inherit name command;
  };

  # Shell actions keep their typed name; the command is what actually runs.
  shellBind =
    {
      id,
      name ? id,
      mods ? [ ],
      key,
      title,
      command,
    }:
    bind {
      inherit
        id
        mods
        key
        title
        ;
      category = categories.shade;
      action = shell name command;
    };
  # Hardware keys fire while the session is locked.
  lockedBind =
    {
      id,
      key,
      title,
      command,
      flags ? flagsLocked,
    }:
    bind {
      inherit
        id
        key
        title
        flags
        ;
      category = categories.media;
      action = run command;
    };

  arrows = [
    "left"
    "right"
    "up"
    "down"
  ];
  # Directional chords also exist on the IJKL cluster (j = left, l = right, i = up, k = down).
  ijkl = {
    left = "j";
    right = "l";
    up = "i";
    down = "k";
  };
  where = {
    left = "à esquerda";
    right = "à direita";
    up = "acima";
    down = "abaixo";
  };
  # Arrow chord plus its IJKL twin; `spec` carries everything except the key.
  withIjkl = dir: spec: [
    (bind (spec // { key = dir; }))
    (bind (
      spec
      // {
        id = "${spec.id}-ijkl";
        key = ijkl.${dir};
      }
    ))
  ];

  appBinds = [
    (bind {
      id = "terminal";
      mods = [ "SUPER" ];
      key = "Return";
      title = "Abrir terminal";
      category = categories.apps;
      action = launch cfg.defaultTerminal;
    })
    (bind {
      id = "browser";
      mods = [ "SUPER" ];
      key = "B";
      title = "Abrir navegador";
      category = categories.apps;
      action = launch cfg.defaultBrowser;
    })
    (bind {
      id = "volume-mixer";
      mods = [ "SUPER" ];
      key = "V";
      title = "Mostrar ou ocultar mixer de volume";
      category = categories.apps;
      action = run "pkill pwvucontrol || pwvucontrol";
    })
    (bind {
      id = "file-manager";
      mods = [ "SUPER" ];
      key = "E";
      title = "Abrir gerenciador de arquivos";
      category = categories.apps;
      action = launch cfg.defaultFileManager;
    })
    (bind {
      id = "code-editor";
      mods = [ "SUPER" ];
      key = "C";
      title = "Abrir editor de código";
      category = categories.apps;
      action = launch "code";
    })
  ];

  systemBinds = [
    (bind {
      id = "reload-config";
      mods = [ "SUPER" ];
      key = "Backspace";
      title = "Recarregar configuração do Hyprland";
      category = categories.system;
      action = run "${hyprctl} reload;${pkgs.libnotify}/bin/notify-send 'Hyprland reloaded'";
    })
    (bind {
      id = "restart-shell";
      mods = [
        "SUPER"
        "CTRL"
      ];
      key = "R";
      title = "Reiniciar o Shade";
      category = categories.system;
      action = run "systemctl --user restart shade-shell";
    })
    (bind {
      id = "exit-session";
      mods = [
        "SUPER"
        "SHIFT"
      ];
      key = "Q";
      title = "Sair do Hyprland";
      category = categories.system;
      action = run "pkill Hyprland";
    })
  ];

  windowBinds = [
    (bind {
      id = "toggle-floating";
      mods = [
        "SUPER"
        "SHIFT"
      ];
      key = "F";
      title = "Alternar modo flutuante";
      category = categories.windows;
      action = dispatch "toggle-float" null;
    })
    (bind {
      id = "group-toggle";
      mods = [
        "SUPER"
        "SHIFT"
      ];
      key = "G";
      title = "Agrupar ou desagrupar janela";
      category = categories.windows;
      action = dispatch "group-toggle" null;
    })
    (bind {
      id = "group-next";
      mods = [ "SUPER" ];
      key = "G";
      title = "Próxima janela do grupo";
      category = categories.windowFocus;
      action = dispatch "group-next" null;
    })
    (bind {
      id = "close-window";
      mods = [ "SUPER" ];
      key = "Q";
      title = "Fechar janela";
      category = categories.windows;
      action = dispatch "close" null;
    })
    (bind {
      id = "pseudo-tile";
      mods = [
        "SUPER"
        "ALT"
      ];
      key = "P";
      title = "Alternar modo pseudo-ladrilho";
      category = categories.windows;
      action = dispatch "pseudo" null;
    })
    (bind {
      id = "exact-pseudo";
      mods = [
        "SUPER"
        "SHIFT"
      ];
      key = "T";
      title = "Pseudo-ladrilho em 1920x1080";
      category = categories.windows;
      action = dispatch "exact-pseudo" null;
    })
    (bind {
      id = "fullscreen";
      mods = [ "SUPER" ];
      key = "F";
      title = "Alternar tela cheia";
      category = categories.windows;
      action = dispatch "fullscreen" null;
    })
  ];

  scratchpadBinds = [
    (bind {
      id = "scratchpad-toggle-pause";
      key = "Pause";
      title = "Mostrar ou ocultar scratchpad";
      category = categories.workspaces;
      action = dispatch "toggle-special-workspace" "scratchpad";
    })
    (bind {
      id = "scratchpad-toggle-insert";
      key = "Insert";
      title = "Mostrar ou ocultar scratchpad";
      category = categories.workspaces;
      action = dispatch "toggle-special-workspace" "scratchpad";
    })
    (bind {
      id = "scratchpad-send-insert";
      mods = [ "SUPER" ];
      key = "Insert";
      title = "Enviar janela ao scratchpad";
      category = categories.workspaces;
      action = dispatch "move" { workspace = "special:scratchpad"; };
    })
    (bind {
      id = "scratchpad-send-pause";
      mods = [ "SUPER" ];
      key = "Pause";
      title = "Enviar janela ao scratchpad";
      category = categories.workspaces;
      action = dispatch "move" { workspace = "special:scratchpad"; };
    })
  ];

  layoutBinds = [
    (bind {
      id = "toggle-split";
      mods = [ "SUPER" ];
      key = "S";
      title = "Alternar divisão do layout";
      category = categories.layout;
      action = dispatch "layout" "togglesplit";
    })
  ];

  focusBinds = lib.concatMap (
    dir:
    withIjkl dir {
      id = "focus-${dir}";
      mods = [ "SUPER" ];
      title = "Focar janela ${where.${dir}}";
      category = categories.windowFocus;
      action = dispatch "focus" { direction = dir; };
    }
  ) arrows;

  moveBinds = lib.concatMap (
    dir:
    withIjkl dir {
      id = "move-window-${dir}";
      mods = [
        "SUPER"
        "SHIFT"
      ];
      title = "Mover janela ${where.${dir}}";
      category = categories.windows;
      action = dispatch "move" { direction = dir; };
    }
  ) arrows;

  workspaceTargets = {
    left = {
      id = "workspace-previous";
      target = "r-1";
      title = "Ir para o espaço de trabalho anterior";
    };
    right = {
      id = "workspace-next";
      target = "r+1";
      title = "Ir para o próximo espaço de trabalho";
    };
    up = {
      id = "workspace-back";
      target = "previous_per_monitor";
      title = "Voltar ao espaço de trabalho anterior do monitor";
    };
    down = {
      id = "workspace-empty";
      target = "emptynm";
      title = "Ir para o próximo espaço de trabalho vazio";
    };
  };
  workspaceBinds = lib.concatMap (
    dir:
    let
      target = workspaceTargets.${dir};
    in
    withIjkl dir {
      inherit (target) id title;
      mods = [
        "SUPER"
        "ALT"
      ];
      category = categories.workspaces;
      action = dispatch "focus" { workspace = target.target; };
    }
  ) arrows;

  # Sending a window to a monitor or workspace is bound on the arrows, and on
  # the IJKL cluster only for up and down.
  sendTargets = {
    left = {
      id = "move-window-monitor-previous";
      args = {
        monitor = "-1";
      };
      title = "Mover janela para o monitor anterior";
    };
    right = {
      id = "move-window-monitor-next";
      args = {
        monitor = "+1";
      };
      title = "Mover janela para o próximo monitor";
    };
    up = {
      id = "move-window-workspace-previous";
      args = {
        workspace = "m-1";
      };
      title = "Mover janela para o espaço de trabalho anterior";
    };
    down = {
      id = "move-window-workspace-empty";
      args = {
        workspace = "emptynm";
      };
      title = "Mover janela para o próximo espaço de trabalho vazio";
    };
  };
  sendBind =
    dir: key: suffix:
    let
      target = sendTargets.${dir};
    in
    bind {
      id = "${target.id}${suffix}";
      mods = [
        "SUPER"
        "SHIFT"
        "ALT"
      ];
      inherit key;
      inherit (target) title;
      category = categories.windows;
      action = dispatch "move" target.args;
    };
  sendBinds =
    map (dir: sendBind dir dir "") arrows
    ++ map (dir: sendBind dir ijkl.${dir} "-ijkl") [
      "up"
      "down"
    ];

  shellBinds = [
    (shellBind {
      id = "display-next";
      mods = [ "SUPER" ];
      key = "M";
      title = "Alternar layouts de monitores";
      command = "shade-shell display-next";
    })
    (shellBind {
      id = "display-mode-chooser";
      mods = [
        "SUPER"
        "ALT"
      ];
      key = "M";
      title = "Escolher modo de exibição";
      command = "shade-shell display-mode-chooser";
    })
    (shellBind {
      id = "display-toggle-internal";
      mods = [
        "SUPER"
        "SHIFT"
      ];
      key = "M";
      title = "Ativar ou desativar monitor interno";
      command = "shade-shell display-toggle-internal";
    })
    (shellBind {
      id = "display-mode-chooser-key";
      name = "display-mode-chooser";
      key = "XF86Display";
      title = "Escolher modo de exibição";
      command = "shade-shell display-mode-chooser";
    })
    # Fn+F7 on the ThinkBook is firmware-mapped to Super+P (libinput: KEY_LEFTMETA + KEY_P).
    (bind {
      id = "display-power-toggle";
      mods = [ "SUPER" ];
      key = "P";
      title = "Apagar ou acender a tela (Fn+F7)";
      category = categories.system;
      action = run "${hyprctl} eval 'hl.dsp.dpms({action=\"toggle\"})'";
    })
    (shellBind {
      id = "toggle-clipboard";
      mods = [
        "SUPER"
        "SHIFT"
      ];
      key = "V";
      title = "Mostrar ou ocultar gerenciador da área de transferência";
      command = shade-action "toggle-clipboard";
    })
    (shellBind {
      id = "toggle-applauncher";
      mods = [ "SUPER" ];
      key = "Space";
      title = "Mostrar ou ocultar lançador de aplicativos";
      command = shade-action "toggle-applauncher";
    })
    (shellBind {
      id = "toggle-quicksettings";
      mods = [ "SUPER" ];
      key = "n";
      title = "Mostrar ou ocultar configurações rápidas";
      command = shade-action "toggle-quicksettings";
    })
    (shellBind {
      id = "toggle-bar";
      mods = [ "SUPER" ];
      key = "w";
      title = "Mostrar ou ocultar barra";
      command = shade-action "toggle-bar";
    })
    (shellBind {
      id = "toggle-windowswitcher";
      mods = [ "SUPER" ];
      key = "TAB";
      title = "Mostrar ou ocultar alternador de janelas";
      command = shade-action "toggle-windowswitcher";
    })
    (shellBind {
      id = "toggle-settings";
      mods = [ "SUPER" ];
      key = "comma";
      title = "Mostrar ou ocultar configurações";
      command = shade-action "toggle-settings";
    })
    (shellBind {
      id = "screenshot-overlay";
      key = "Print";
      title = "Mostrar ou ocultar painel de captura de tela";
      command = shade-action "screenshot-overlay";
    })
    (shellBind {
      id = "screenshot";
      mods = [
        "SUPER"
        "SHIFT"
      ];
      key = "S";
      title = "Capturar tela";
      command = shade-action "screenshot";
    })
    (shellBind {
      id = "record";
      mods = [
        "SUPER"
        "SHIFT"
      ];
      key = "R";
      title = "Iniciar ou parar gravação";
      command = shade-action "record";
    })
    (shellBind {
      id = "record-area";
      mods = [
        "SUPER"
        "SHIFT"
      ];
      key = "P";
      title = "Gravar área selecionada";
      command = shade-action "record-area";
    })
  ];

  groupBinds =
    map (
      dir:
      bind {
        id = "group-move-in-${dir}";
        mods = [
          "SUPER"
          "CTRL"
          "ALT"
        ];
        key = dir;
        title = "Mover janela para o grupo ${where.${dir}}";
        category = categories.windows;
        action = dispatch "move" { into_group = dir; };
      }
    ) arrows
    ++ [
      (bind {
        id = "group-move-out";
        mods = [
          "SUPER"
          "CTRL"
          "ALT"
        ];
        key = "G";
        title = "Tirar janela do grupo";
        category = categories.windows;
        action = dispatch "move" { out_of_group = true; };
      })
      (bind {
        id = "group-lock";
        mods = [
          "SUPER"
          "ALT"
        ];
        key = "G";
        title = "Bloquear grupo ativo";
        category = categories.windows;
        action = dispatch "group-lock" null;
      })
    ];

  zoomBinds = [
    (bind {
      id = "zoom-in";
      mods = [ "SUPER" ];
      key = "mouse_up";
      title = "Aumentar zoom";
      category = categories.zoom;
      action = run "${zoom} 0.25";
    })
    (bind {
      id = "zoom-out";
      mods = [ "SUPER" ];
      key = "mouse_down";
      title = "Diminuir zoom";
      category = categories.zoom;
      action = run "${zoom} -0.25";
    })
    (bind {
      id = "zoom-reset";
      mods = [ "SUPER" ];
      key = "0";
      title = "Restaurar zoom";
      category = categories.zoom;
      action = run "${zoom} 0";
    })
  ];

  mediaBinds = [
    (lockedBind {
      id = "media-key-play-pause";
      key = "XF86AudioMedia";
      title = "Reproduzir ou pausar mídia";
      command = "${playerctl} play-pause";
    })
    (lockedBind {
      id = "media-play-pause";
      key = "XF86AudioPlay";
      title = "Reproduzir ou pausar mídia";
      command = "${playerctl} play-pause";
    })
    (lockedBind {
      id = "media-stop";
      key = "XF86AudioStop";
      title = "Parar reprodução";
      command = "${playerctl} stop";
    })
    (lockedBind {
      id = "media-previous";
      key = "XF86AudioPrev";
      title = "Faixa anterior";
      command = "${playerctl} previous";
    })
    (lockedBind {
      id = "media-next";
      key = "XF86AudioNext";
      title = "Próxima faixa";
      command = "${playerctl} next";
    })
    (lockedBind {
      id = "audio-mute";
      key = "XF86AudioMute";
      title = "Silenciar ou reativar o áudio";
      command = "wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle";
    })
    (lockedBind {
      id = "microphone-mute";
      key = "XF86AudioMicMute";
      title = "Silenciar ou reativar o microfone";
      command = "wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle";
    })
    (lockedBind {
      id = "brightness-up";
      key = "XF86MonBrightnessUp";
      title = "Aumentar brilho";
      command = "astal-brightness set +5%";
    })
    (lockedBind {
      id = "brightness-down";
      key = "XF86MonBrightnessDown";
      title = "Diminuir brilho";
      command = "astal-brightness set 5%-";
    })
    (lockedBind {
      id = "volume-up";
      key = "XF86AudioRaiseVolume";
      title = "Aumentar volume";
      command = "wpctl set-volume -l '1.0' @DEFAULT_AUDIO_SINK@ 5%+";
      flags = flagsLockedRepeating;
    })
    (lockedBind {
      id = "volume-down";
      key = "XF86AudioLowerVolume";
      title = "Diminuir volume";
      command = "wpctl set-volume -l '1.0' @DEFAULT_AUDIO_SINK@ 5%-";
      flags = flagsLockedRepeating;
    })
  ];

  mouseBinds = [
    (bind {
      id = "drag-window";
      mods = [ "SUPER" ];
      key = "mouse:272";
      title = "Arrastar janela";
      category = categories.windows;
      action = dispatch "drag" null;
      flags = flagsMouse;
    })
    (bind {
      id = "resize-window-mouse";
      mods = [ "SUPER" ];
      key = "mouse:273";
      title = "Redimensionar janela com o mouse";
      category = categories.windows;
      action = dispatch "resize" null;
      flags = flagsMouse;
    })
  ];

  resizeStep = {
    left = {
      x = -64;
      y = 0;
    };
    right = {
      x = 64;
      y = 0;
    };
    up = {
      x = 0;
      y = -64;
    };
    down = {
      x = 0;
      y = 64;
    };
  };
  resizeBinds = lib.concatMap (
    dir:
    withIjkl dir {
      id = "resize-window-${dir}";
      mods = [
        "SUPER"
        "CTRL"
      ];
      title = "Redimensionar janela ${where.${dir}}";
      category = categories.windows;
      action = dispatch "resize" (resizeStep.${dir} // { relative = true; });
      flags = flagsRepeating;
    }
  ) arrows;

  specs =
    appBinds
    ++ systemBinds
    ++ windowBinds
    ++ scratchpadBinds
    ++ layoutBinds
    ++ focusBinds
    ++ moveBinds
    ++ workspaceBinds
    ++ sendBinds
    ++ shellBinds
    ++ groupBinds
    ++ zoomBinds
    ++ mediaBinds
    ++ mouseBinds
    ++ resizeBinds;

  # Same ordering as the model's chord validation: modifiers first, case-insensitive.
  canonicalChord =
    keys:
    let
      rank =
        part:
        {
          CTRL = 0;
          CONTROL = 0;
          SHIFT = 1;
          ALT = 2;
          SUPER = 3;
        }
        .${part} or 10;
    in
    lib.concatStringsSep "+" (
      lib.sort (left: right: rank left < rank right) (
        map (part: lib.toUpper (lib.strings.trim part)) (lib.splitString "+" keys)
      )
    );
  duplicates =
    values: lib.unique (lib.filter (value: lib.count (other: other == value) values > 1) values);
  chordDuplicates = duplicates (map (spec: canonicalChord spec.keys) specs);
  idDuplicates = duplicates (map (spec: spec.id) specs);
in
{
  options.programs.shade.desktop.hyprland.binds.specs = lib.mkOption {
    type = lib.types.listOf (lib.types.attrsOf lib.types.anything);
    default = lib.optionals (cfg.hyprland.enable && cfg.hyprland.binds.enable) specs;
    readOnly = true;
    internal = true;
    description = ''
      Default Hyprland key bindings as compositor seed BindSpec entries. They are
      serialised into /etc/xdg/shade/compositor-seed.json, from which Shade renders
      the compositor Lua and lets the user edit them at runtime.
    '';
  };

  config = lib.mkIf cfg.hyprland.enable {
    assertions = lib.optionals cfg.hyprland.binds.enable [
      {
        assertion = chordDuplicates == [ ];
        message = "Hyprland key bindings must be unique: ${lib.concatStringsSep "; " chordDuplicates}";
      }
      {
        assertion = idDuplicates == [ ];
        message = "Hyprland bind ids must be unique: ${lib.concatStringsSep "; " idDuplicates}";
      }
    ];
  };
}
