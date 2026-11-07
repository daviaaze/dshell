# Native Hyprland 0.57 configuration emitter. Binds are emitted separately.
lib: settings:
let
  fail = message: throw "Hyprland Lua configuration: ${message}";
  trim = lib.strings.trim;
  quote = value:
    let s = toString value;
    in "\"${lib.replaceStrings [ "\\" "\"" "\n" "\r" "\t" ] [ "\\\\" "\\\"" "\\n" "\\r" "\\t" ] s}\"";
  lua = value:
    if value == null then fail "null has no configuration representation; remove the option instead"
    else if builtins.isBool value then (if value then "true" else "false")
    else if builtins.isInt value || builtins.isFloat value then toString value
    else if builtins.isString value || builtins.isPath value then quote value
    else if builtins.isList value then "{ ${lib.concatMapStringsSep ", " lua value} }"
    else if builtins.isAttrs value then "{ ${lib.concatStringsSep ", " (lib.mapAttrsToList (k: v: "[${quote k}] = ${lua v}") value)} }"
    else fail "unsupported Nix value type ${builtins.typeOf value}";
  bool = value:
    if builtins.isBool value then value
    else if builtins.elem value [ "1" "true" "yes" "on" ] then true
    else if builtins.elem value [ "0" "false" "no" "off" ] then false
    else fail "invalid boolean ${toString value}";
  number = value:
    if builtins.isInt value || builtins.isFloat value then value
    else if builtins.match "-?[0-9]+(\\.[0-9]+)?" value != null then builtins.fromJSON value
    else fail "invalid number ${toString value}";
  comma = value: if builtins.isString value then map trim (lib.splitString "," value) else fail "expected a rule string or native attribute set";
  firstSplit = separator: value:
    let parts = lib.splitString separator value;
    in if builtins.length parts < 2 then fail "expected '${separator}' in ${value}"
       else { key = trim (builtins.head parts); value = trim (lib.concatStringsSep separator (builtins.tail parts)); };
  takeWhile = predicate: values:
    if values == [ ] || !(predicate (builtins.head values)) then [ ]
    else [ (builtins.head values) ] ++ takeWhile predicate (builtins.tail values);
  add = attrs: key: value:
    if builtins.hasAttr key attrs then fail "duplicate rule field ${key}"
    else attrs // { ${key} = value; };
  call = name: value: "hl.${name}(${lua value})";
  merge = left: right: lib.foldlAttrs (acc: key: value:
    if !builtins.hasAttr key acc then acc // { ${key} = value; }
    else if builtins.isAttrs acc.${key} && builtins.isAttrs value then acc // { ${key} = merge acc.${key} value; }
    else fail "overlapping configuration key ${key}"
  ) left right;
  expand = attrs: lib.foldlAttrs (acc: key: value:
    let path = lib.splitString "." (lib.replaceStrings [ ":" ] [ "." ] key);
        expanded = if builtins.isAttrs value then expand value else value;
    in if builtins.elem "" path then fail "empty configuration key in ${key}"
       else merge acc (lib.setAttrByPath path expanded)
  ) { } attrs;
  monitorFields = lib.splitString " " "disabled transform mirror bitdepth cm sdr_eotf sdrbrightness sdrsaturation vrr icc supports_wide_color supports_hdr sdr_min_luminance sdr_max_luminance min_luminance max_luminance max_avg_luminance";
  monitorNumbers = lib.splitString " " "transform bitdepth sdrbrightness sdrsaturation vrr supports_wide_color supports_hdr sdr_min_luminance sdr_max_luminance min_luminance max_luminance max_avg_luminance";
  monitor = entry:
    if builtins.isAttrs entry then call "monitor" entry else
    let p = comma entry; n = builtins.length p; at = builtins.elemAt p;
        extras = rest: acc:
          if rest == [ ] then acc
          else if builtins.length rest < 2 then fail "monitor option without value: ${entry}"
          else let k = builtins.head rest; v = builtins.elemAt rest 1;
          in if !(builtins.elem k monitorFields) then fail "unsupported monitor option ${k}"
             else extras (lib.drop 2 rest) (add acc k (if builtins.elem k monitorNumbers then number v else if k == "disabled" then bool v else v));
    in if n == 2 && builtins.elem (at 1) [ "disable" "disabled" ] then call "monitor" { output = at 0; disabled = true; }
       else if n == 6 && at 1 == "addreserved" then call "monitor" { output = at 0; reserved = { top = number (at 2); right = number (at 5); bottom = number (at 3); left = number (at 4); }; }
       else if n < 4 then fail "unsupported monitor rule ${entry}"
       else call "monitor" (extras (lib.drop 4 p) { output = at 0; mode = at 1; position = at 2; scale = at 3; });
  workspaceAliases = { gapsin = "gaps_in"; gapsout = "gaps_out"; bordersize = "border_size"; border = "no_border"; rounding = "no_rounding"; "on-created-empty" = "on_created_empty"; "defaultName" = "default_name"; };
  workspaceBools = [ "default" "persistent" "no_border" "no_rounding" "decorate" "no_shadow" ];
  workspaceFields = workspaceBools ++ [ "monitor" "gaps_in" "gaps_out" "float_gaps" "border_size" "on_created_empty" "default_name" "layout" "animation" ];
  workspace = entry:
    if builtins.isAttrs entry then call "workspace_rule" entry else
    let p = comma entry;
        attrs = lib.foldl' (acc: part:
          if lib.hasPrefix "layoutopt:" part then
            let kv = firstSplit ":" (lib.removePrefix "layoutopt:" part); in
            acc // { layout_opts = add (acc.layout_opts or { }) kv.key kv.value; }
          else let kv = firstSplit ":" part; k = workspaceAliases.${kv.key} or kv.key;
                   v = if builtins.elem k workspaceBools then (if builtins.elem kv.key [ "border" "rounding" ] then !(bool kv.value) else bool kv.value)
                       else if k == "border_size" then number kv.value else kv.value;
               in if !(builtins.elem k workspaceFields) then fail "unsupported workspace field ${kv.key}"
                  else add acc k v
        ) { workspace = builtins.head p; } (lib.drop 1 p);
    in call "workspace_rule" attrs;
  windowBools = lib.splitString " " "float tile fullscreen maximize center pseudo no_initial_focus pin persistent_size allows_input dim_around decorate focus_on_activate keep_aspect_ratio nearest_neighbor no_anim no_blur no_dim no_focus no_follow_mouse no_max_size no_shadow no_glow no_wobble no_shortcuts_inhibit opaque force_rgbx sync_fullscreen immediate xray render_unfocused no_screen_share no_vrr no_auto_hdr stay_focused confine_pointer no_xdg_drags";
  layerBools = lib.splitString " " "no_anim blur blur_popups dim_around xray no_screen_share";
  rule = layer: entry:
    if builtins.isAttrs entry then call (if layer then "layer_rule" else "window_rule") entry else
    let parts = comma entry;
        attrs = lib.foldl' (acc: part:
          if lib.hasPrefix "match:" part then
            let kv = firstSplit " " (lib.removePrefix "match:" part);
            in acc // { match = add (acc.match or { }) kv.key
              (if builtins.elem kv.key [ "float" "fullscreen" "pin" "focus" "group" "xwayland" ] then bool kv.value else kv.value); }
          else let kv = firstSplit " " part; k = kv.key;
                   v = if builtins.elem k (if layer then layerBools else windowBools) then bool kv.value
                       else if builtins.elem k [ "no_close_for" "scrolling_width" "rounding" "border_size" "rounding_power" "scroll_mouse" "scroll_touchpad" "ignore_alpha" "order" "above_lock" ] then number kv.value else kv.value;
               in add acc k v
        ) { } parts;
    in if !(attrs ? match) then fail "rule needs explicit match: selectors: ${entry}"
       else call (if layer then "layer_rule" else "window_rule") attrs;
  gesture = entry:
    if builtins.isAttrs entry then call "gesture" entry else
    let p = comma entry; n = builtins.length p; at = builtins.elemAt p;
        rest = lib.drop 2 p;
        options = takeWhile (x: lib.hasPrefix "mod:" x || lib.hasPrefix "scale:" x || x == "disableinhibit") rest;
        actionParts = lib.drop (builtins.length options) rest;
        action = builtins.head actionParts;
        args = lib.drop 1 actionParts;
        attrs = lib.foldl' (acc: opt:
          if opt == "disableinhibit" then add acc "disable_inhibit" true
          else let kv = firstSplit ":" opt; in add acc (if kv.key == "mod" then "mods" else "scale") (if kv.key == "scale" then number kv.value else kv.value)
        ) { fingers = number (at 0); direction = at 1; inherit action; } options;
        final = if args == [ ] then attrs
          else if builtins.length args == 1 && builtins.elem action [ "special" "float" "fullscreen" "cursor_zoom" "cursorZoom" ] then attrs // { ${if action == "special" then "workspace_name" else if builtins.elem action [ "cursor_zoom" "cursorZoom" ] then "zoom_level" else "mode"} = builtins.head args; }
          else fail "unsupported gesture arguments: ${entry}";
    in if n < 3 || actionParts == [ ] then fail "invalid gesture ${entry}" else call "gesture" final;
  bezier = entry:
    let p = comma entry; at = builtins.elemAt p;
    in if builtins.length p != 5 then fail "bezier needs name and four coordinates"
       else "hl.curve(${quote (at 0)}, ${lua { type = "bezier"; points = [ [ (number (at 1)) (number (at 2)) ] [ (number (at 3)) (number (at 4)) ] ]; }})";
  animation = entry:
    if builtins.isAttrs entry then call "animation" entry else
    let p = comma entry; n = builtins.length p; at = builtins.elemAt p;
    in if n == 2 && !(bool (at 1)) then call "animation" { leaf = at 0; enabled = false; }
       else if n < 4 || n > 5 then fail "invalid animation ${entry}"
       else call "animation" ({ leaf = at 0; enabled = bool (at 1); speed = number (at 2); bezier = at 3; } // lib.optionalAttrs (n == 5) { style = at 4; });
  env = dbus: entry:
    let kv = firstSplit "," entry;
    in "hl.env(${quote kv.key}, ${quote kv.value}, ${lua dbus})";
  special = [ "monitor" "workspace" "windowrule" "layerrule" "gesture" "bezier" "animation" "exec" "exec-once" "env" "envd" "device" "source" "permission" ];
  bindKey = key: builtins.elem key [ "bind" "bindd" "bindn" "bindm" "binde" "bindl" "bindle" "bindr" ];
  ordinary = lib.filterAttrs (key: _: !(builtins.elem key special) && !(bindKey key)) settings;
  entries = key: fn:
    if !(builtins.hasAttr key settings) then ""
    else let value = settings.${key}; in lib.concatMapStringsSep "\n" fn (if builtins.isList value then value else [ value ]);
  unsupported = key: entries key (_: fail "${key} is not supported by this emitter; express it through the native Lua integration");
in
if !builtins.isAttrs settings then fail "settings must be an attribute set" else
lib.concatStringsSep "\n" [
  (lib.concatStringsSep "\n" (lib.mapAttrsToList (key: _: fail "move ${key} bindings to programs.shade.desktop.hyprland.extraLuaConfig using hl.bind") (lib.filterAttrs (key: _: bindKey key) settings)))
  (call "config" (expand ordinary))
  (entries "env" (env false))
  (entries "envd" (env true))
  (entries "monitor" monitor)
  (entries "workspace" workspace)
  (entries "windowrule" (rule false))
  (entries "layerrule" (rule true))
  (entries "bezier" bezier)
  (entries "animation" animation)
  (entries "gesture" gesture)
  (entries "exec" (entry: "hl.exec_cmd(${quote entry})"))
  (if !(settings ? "exec-once") then "" else "hl.on(\"hyprland.start\", function()\n${entries "exec-once" (entry: "  hl.exec_cmd(${quote entry})")}\nend)")
  (entries "device" (call "device"))
  (unsupported "source")
  (unsupported "permission")
] + "\n"
