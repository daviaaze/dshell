# Serialises the Nix-resolved Hyprland configuration into the versioned
# CompositorSeed document (packages/compositor-model/src/types.ts).
#
# Nix renders no Lua. Each parser below turns a Hyprland rule string into the
# plain value that the TypeScript model renders when `shade-shell compositor
# render` runs at login. The parsers are the former Lua emitter's, minus the Lua
# text, so every table the compositor receives keeps the same fields and types.
{
  lib,
  # Resolved `programs.hyprland.settings`: defaults, host overrides and module rules.
  settings,
  # Resolved `programs.hyprland.plugins`.
  plugins,
  # BindSpec list from ./binds.nix.
  binds,
  # `programs.shade.desktop.hyprland.layouts` and `.defaultLayout`.
  layouts,
  defaultLayout,
  # User-authored native Lua: appended verbatim, never edited or introspected.
  extraLuaConfig,
  # `{ id; rule; }` pairs that give the built-in window rules stable ids.
  windowRuleIds,
}:
let
  fail = message: throw "Compositor seed: ${message}";
  trim = lib.strings.trim;
  asList = value: if builtins.isList value then value else [ value ];
  entries = key: if settings ? ${key} then asList settings.${key} else [ ];

  # JSON-safe copy of a configuration value. Paths become strings (as the Lua
  # emitter did) and null has no representation, so it is rejected.
  plain =
    path: value:
    if value == null then
      fail "${path}: null has no configuration representation; remove the option instead"
    else if
      builtins.isBool value || builtins.isInt value || builtins.isFloat value || builtins.isString value
    then
      value
    else if builtins.isPath value then
      toString value
    else if builtins.isList value then
      lib.imap0 (index: item: plain "${path}[${toString index}]" item) value
    else if builtins.isAttrs value then
      lib.mapAttrs (name: item: plain "${path}.${name}" item) value
    else
      fail "${path}: unsupported Nix value type ${builtins.typeOf value}";

  bool =
    value:
    if builtins.isBool value then
      value
    else if
      builtins.elem value [
        "1"
        "true"
        "yes"
        "on"
      ]
    then
      true
    else if
      builtins.elem value [
        "0"
        "false"
        "no"
        "off"
      ]
    then
      false
    else
      fail "invalid boolean ${toString value}";
  number =
    value:
    if builtins.isInt value || builtins.isFloat value then
      value
    else if builtins.match "-?[0-9]+(\\.[0-9]+)?" value != null then
      builtins.fromJSON value
    else
      fail "invalid number ${toString value}";
  comma =
    value:
    if builtins.isString value then
      map trim (lib.splitString "," value)
    else
      fail "expected a rule string or native attribute set";
  splitPair =
    separator: value:
    let
      parts = lib.splitString separator value;
    in
    if builtins.length parts < 2 then
      fail "expected '${separator}' in ${value}"
    else
      {
        key = trim (builtins.head parts);
        value = trim (lib.concatStringsSep separator (builtins.tail parts));
      };
  takeWhile =
    predicate: values:
    if values == [ ] || !(predicate (builtins.head values)) then
      [ ]
    else
      [ (builtins.head values) ] ++ takeWhile predicate (builtins.tail values);
  add =
    attrs: key: value:
    if builtins.hasAttr key attrs then
      fail "duplicate rule field ${key}"
    else
      attrs // { ${key} = value; };

  # Ordinary options: `a.b` and `a:b` keys become nested tables, as hl.config expects.
  merge =
    left: right:
    lib.foldlAttrs (
      acc: key: value:
      if !builtins.hasAttr key acc then
        acc // { ${key} = value; }
      else if builtins.isAttrs acc.${key} && builtins.isAttrs value then
        acc // { ${key} = merge acc.${key} value; }
      else
        fail "overlapping configuration key ${key}"
    ) left right;
  expand =
    attrs:
    lib.foldlAttrs (
      acc: key: value:
      let
        path = lib.splitString "." (lib.replaceStrings [ ":" ] [ "." ] key);
        expanded = if builtins.isAttrs value then expand value else value;
      in
      if builtins.elem "" path then
        fail "empty configuration key in ${key}"
      else
        merge acc (lib.setAttrByPath path expanded)
    ) { } attrs;

  # Keys that are not hl.config values: they are modelled as explicit seed fields.
  special = [
    "monitor"
    "workspace"
    "windowrule"
    "layerrule"
    "gesture"
    "bezier"
    "animation"
    "exec"
    "exec-once"
    "env"
    "envd"
    "device"
    "source"
    "permission"
  ];
  isBindKey =
    key:
    builtins.elem key [
      "bind"
      "bindd"
      "bindn"
      "bindm"
      "binde"
      "bindl"
      "bindle"
      "bindr"
    ];
  bindKeys = builtins.attrNames (lib.filterAttrs (key: _: isBindKey key) settings);
  unsupportedKeys = builtins.filter (key: settings ? ${key} && entries key != [ ]) [
    "source"
    "permission"
  ];
  ordinary = lib.filterAttrs (key: _: !(builtins.elem key special) && !(isBindKey key)) settings;
  expandedSettings = expand ordinary;
  inputSettings = expandedSettings.input or { };

  env =
    entry:
    let
      kv = splitPair "," entry;
    in
    "${kv.key},${kv.value}";

  monitorFields = lib.splitString " " "disabled transform mirror bitdepth cm sdr_eotf sdrbrightness sdrsaturation vrr icc supports_wide_color supports_hdr sdr_min_luminance sdr_max_luminance min_luminance max_luminance max_avg_luminance";
  monitorNumbers = lib.splitString " " "transform bitdepth sdrbrightness sdrsaturation vrr supports_wide_color supports_hdr sdr_min_luminance sdr_max_luminance min_luminance max_luminance max_avg_luminance";
  monitor =
    entry:
    if builtins.isAttrs entry then
      entry
    else
      let
        p = comma entry;
        n = builtins.length p;
        at = builtins.elemAt p;
        extras =
          rest: acc:
          if rest == [ ] then
            acc
          else if builtins.length rest < 2 then
            fail "monitor option without value: ${entry}"
          else
            let
              k = builtins.head rest;
              v = builtins.elemAt rest 1;
            in
            if !(builtins.elem k monitorFields) then
              fail "unsupported monitor option ${k}"
            else
              extras (lib.drop 2 rest) (
                add acc k (
                  if builtins.elem k monitorNumbers then
                    number v
                  else if k == "disabled" then
                    bool v
                  else
                    v
                )
              );
      in
      if
        n == 2
        && builtins.elem (at 1) [
          "disable"
          "disabled"
        ]
      then
        {
          output = at 0;
          disabled = true;
        }
      else if n == 6 && at 1 == "addreserved" then
        {
          output = at 0;
          reserved = {
            top = number (at 2);
            right = number (at 5);
            bottom = number (at 3);
            left = number (at 4);
          };
        }
      else if n < 4 then
        fail "unsupported monitor rule ${entry}"
      else
        extras (lib.drop 4 p) {
          output = at 0;
          mode = at 1;
          position = at 2;
          scale = at 3;
        };

  workspaceAliases = {
    gapsin = "gaps_in";
    gapsout = "gaps_out";
    bordersize = "border_size";
    border = "no_border";
    rounding = "no_rounding";
    "on-created-empty" = "on_created_empty";
    "defaultName" = "default_name";
  };
  workspaceBools = [
    "default"
    "persistent"
    "no_border"
    "no_rounding"
    "decorate"
    "no_shadow"
  ];
  workspaceFields = workspaceBools ++ [
    "monitor"
    "gaps_in"
    "gaps_out"
    "float_gaps"
    "border_size"
    "on_created_empty"
    "default_name"
    "layout"
    "animation"
  ];
  workspace =
    entry:
    if builtins.isAttrs entry then
      entry
    else
      let
        p = comma entry;
      in
      lib.foldl' (
        acc: part:
        if lib.hasPrefix "layoutopt:" part then
          let
            kv = splitPair ":" (lib.removePrefix "layoutopt:" part);
          in
          acc // { layout_opts = add (acc.layout_opts or { }) kv.key kv.value; }
        else
          let
            kv = splitPair ":" part;
            k = workspaceAliases.${kv.key} or kv.key;
            v =
              if builtins.elem k workspaceBools then
                (
                  if
                    builtins.elem kv.key [
                      "border"
                      "rounding"
                    ]
                  then
                    !(bool kv.value)
                  else
                    bool kv.value
                )
              else if k == "border_size" then
                number kv.value
              else
                kv.value;
          in
          if !(builtins.elem k workspaceFields) then
            fail "unsupported workspace field ${kv.key}"
          else
            add acc k v
      ) { workspace = builtins.head p; } (lib.drop 1 p);

  matchBooleans = [
    "float"
    "fullscreen"
    "pin"
    "focus"
    "group"
    "xwayland"
  ];
  windowBools = lib.splitString " " "float tile fullscreen maximize center pseudo no_initial_focus pin persistent_size allows_input dim_around decorate focus_on_activate keep_aspect_ratio nearest_neighbor no_anim no_blur no_dim no_focus no_follow_mouse no_max_size no_shadow no_glow no_wobble no_shortcuts_inhibit opaque force_rgbx sync_fullscreen immediate xray render_unfocused no_screen_share no_vrr no_auto_hdr stay_focused confine_pointer no_xdg_drags";
  layerBools = lib.splitString " " "no_anim blur blur_popups dim_around xray no_screen_share";
  ruleNumbers = [
    "no_close_for"
    "scrolling_width"
    "rounding"
    "border_size"
    "rounding_power"
    "scroll_mouse"
    "scroll_touchpad"
    "ignore_alpha"
    "order"
    "above_lock"
  ];
  # `effect value, match:selector value` string -> { match; effects }.
  parseRule =
    layer: entry:
    let
      parsed = lib.foldl' (
        acc: part:
        if lib.hasPrefix "match:" part then
          let
            kv = splitPair " " (lib.removePrefix "match:" part);
          in
          acc
          // {
            match = add (acc.match or { }) kv.key (
              if builtins.elem kv.key matchBooleans then bool kv.value else kv.value
            );
          }
        else
          let
            kv = splitPair " " part;
            value =
              if builtins.elem kv.key (if layer then layerBools else windowBools) then
                bool kv.value
              else if builtins.elem kv.key ruleNumbers then
                number kv.value
              else
                kv.value;
          in
          acc // { effects = add (acc.effects or { }) kv.key value; }
      ) { } (comma entry);
    in
    if !(parsed ? match) then
      fail "rule needs explicit match: selectors: ${entry}"
    else
      {
        inherit (parsed) match;
        effects = parsed.effects or { };
      };

  gesture =
    entry:
    if builtins.isAttrs entry then
      entry
    else
      let
        p = comma entry;
        n = builtins.length p;
        at = builtins.elemAt p;
        rest = lib.drop 2 p;
        options = takeWhile (
          x: lib.hasPrefix "mod:" x || lib.hasPrefix "scale:" x || x == "disableinhibit"
        ) rest;
        actionParts = lib.drop (builtins.length options) rest;
        action = builtins.head actionParts;
        args = lib.drop 1 actionParts;
        attrs =
          lib.foldl'
            (
              acc: opt:
              if opt == "disableinhibit" then
                add acc "disable_inhibit" true
              else
                let
                  kv = splitPair ":" opt;
                in
                add acc (if kv.key == "mod" then "mods" else "scale") (
                  if kv.key == "scale" then number kv.value else kv.value
                )
            )
            {
              fingers = number (at 0);
              direction = at 1;
              inherit action;
            }
            options;
        final =
          if args == [ ] then
            attrs
          else if
            builtins.length args == 1
            && builtins.elem action [
              "special"
              "float"
              "fullscreen"
              "cursor_zoom"
              "cursorZoom"
            ]
          then
            attrs
            // {
              ${
                if action == "special" then
                  "workspace_name"
                else if
                  builtins.elem action [
                    "cursor_zoom"
                    "cursorZoom"
                  ]
                then
                  "zoom_level"
                else
                  "mode"
              } =
                builtins.head args;
            }
          else
            fail "unsupported gesture arguments: ${entry}";
      in
      if n < 3 || actionParts == [ ] then fail "invalid gesture ${entry}" else final;

  # hl.curve takes the curve name and a { type; points } table.
  bezier =
    entry:
    let
      p = comma entry;
      at = builtins.elemAt p;
    in
    if builtins.length p != 5 then
      fail "bezier needs name and four coordinates"
    else
      {
        name = at 0;
        type = "bezier";
        points = [
          [
            (number (at 1))
            (number (at 2))
          ]
          [
            (number (at 3))
            (number (at 4))
          ]
        ];
      };

  animation =
    entry:
    if builtins.isAttrs entry then
      entry
    else
      let
        p = comma entry;
        n = builtins.length p;
        at = builtins.elemAt p;
      in
      if n == 2 && !(bool (at 1)) then
        {
          leaf = at 0;
          enabled = false;
        }
      else if n < 4 || n > 5 then
        fail "invalid animation ${entry}"
      else
        {
          leaf = at 0;
          enabled = bool (at 1);
          speed = number (at 2);
          bezier = at 3;
        }
        // lib.optionalAttrs (n == 5) { style = at 4; };

  # Ids must survive rebuilds so user overrides keep matching: derive them from
  # the entry text (store hashes stripped) and number exact repeats.
  stableText =
    text:
    lib.concatStrings (
      builtins.filter builtins.isString (
        builtins.split "/nix/store/[0-9a-z]{32}-" (builtins.unsafeDiscardStringContext text)
      )
    );
  hashId =
    prefix: text:
    "${prefix}-${builtins.substring 0 10 (builtins.hashString "sha256" (stableText text))}";
  uniqueIds =
    candidates:
    (lib.foldl'
      (
        state: candidate:
        let
          seen = state.counts.${candidate.id} or 0;
          id = if seen == 0 then candidate.id else "${candidate.id}-${toString (seen + 1)}";
        in
        {
          counts = state.counts // {
            ${candidate.id} = seen + 1;
          };
          items = state.items ++ [ (candidate.value // { inherit id; }) ];
        }
      )
      {
        counts = { };
        items = [ ];
      }
      candidates
    ).items;

  windowRule =
    entry:
    if builtins.isAttrs entry then
      {
        id = entry.name or (hashId "rule" (builtins.toJSON entry));
        value = {
          match = plain "windowrule.match" (entry.match or { });
          effects = plain "windowrule" (
            removeAttrs entry [
              "match"
              "name"
            ]
          );
          enabled = true;
        };
      }
    else
      let
        parsed = parseRule false entry;
        known = lib.findFirst (definition: definition.rule == entry) null windowRuleIds;
      in
      {
        id = if known != null then known.id else hashId "rule" entry;
        value = {
          inherit (parsed) match effects;
          enabled = true;
        };
      };
  layerRule =
    entry:
    if builtins.isAttrs entry then
      {
        match = plain "layerrule.match" (entry.match or { });
        effects = plain "layerrule" (removeAttrs entry [ "match" ]);
        enabled = true;
      }
    else
      let
        parsed = parseRule true entry;
      in
      {
        inherit (parsed) match effects;
        enabled = true;
      };

  # `exec` runs while the config loads; `exec-once` waits for hyprland.start.
  startup = phase: key: command: {
    id = hashId key (toString command);
    value = {
      command = toString command;
      enabled = true;
      inherit phase;
    };
  };

  pluginPath =
    plugin: if lib.isDerivation plugin then "${plugin}/lib/lib${plugin.pname}.so" else toString plugin;

  monitorProfile = layout: {
    monitors = map (
      monitor:
      {
        inherit (monitor)
          name
          resolution
          position
          scale
          transform
          vrr
          mirror
          bitdepth
          cm
          sdrbrightness
          sdrsaturation
          ;
        disabled = monitor.disable;
      }
      // lib.optionalAttrs (monitor.desc != null) { description = monitor.desc; }
    ) layout.monitors;
    inherit (layout) workspaces auto;
  };

  envEntries = map env (entries "env");
  envdEntries = map env (entries "envd");
  seedSettings =
    removeAttrs expandedSettings [ "input" ]
    // lib.optionalAttrs (envEntries != [ ]) { env = envEntries; }
    // lib.optionalAttrs (envdEntries != [ ]) { envd = envdEntries; };
in
if !(builtins.isAttrs settings) then
  fail "settings must be an attribute set"
else if bindKeys != [ ] then
  fail "move ${builtins.head bindKeys} bindings to programs.shade.desktop.hyprland.extraLuaConfig using hl.bind"
else if unsupportedKeys != [ ] then
  fail "${builtins.head unsupportedKeys} is not supported; express it through programs.shade.desktop.hyprland.extraLuaConfig"
else if !(builtins.isAttrs inputSettings) then
  fail "input settings must be an attribute set"
else
  {
    version = 1;
    settings = plain "settings" seedSettings;
    input = plain "input" inputSettings;
    inherit binds;
    monitorRules = map (entry: plain "monitor" (monitor entry)) (entries "monitor");
    workspaceRules = map (entry: plain "workspace" (workspace entry)) (entries "workspace");
    windowRules = uniqueIds (map windowRule (entries "windowrule"));
    layerRules = map layerRule (entries "layerrule");
    gestures = map (entry: plain "gesture" (gesture entry)) (entries "gesture");
    curves = map bezier (entries "bezier");
    animations = map (entry: plain "animation" (animation entry)) (entries "animation");
    startup = uniqueIds (
      map (startup "load" "exec") (entries "exec")
      ++ map (startup "start" "exec-once") (entries "exec-once")
    );
    devices = map (entry: plain "device" entry) (entries "device");
    plugins = map pluginPath plugins;
    layouts = {
      current = defaultLayout;
      layouts = lib.mapAttrs (_: monitorProfile) layouts;
    };
    inherit extraLuaConfig;
  }
