# Knowledge Sources for Astal / AGS / GTK4 Shell Development

> Links, docs, communities, and reference implementations. Bookmark these. Check them before writing new features.

---

## 1. Official Documentation (Read These First)

### Astal (AyLur's Toolkit)
| Resource | URL | What It's For |
|----------|-----|---------------|
| **Astal GitHub** | https://github.com/Aylur/astal | Source of truth. Read the issues and PRs. |
| **Astal Docs** | https://aylur.github.io/astal/ | Official docs for Astal core, CLI, and libraries. |
| **Astal Wiki / Guide** | https://aylur.github.io/astal/guide/ | Getting started, project structure, best practices. |
| **Astal Libs** | https://github.com/Aylur/astal/tree/main/lib | Vala source for every Astal service (network, battery, MPRIS, etc.). When types are missing or unclear, read the Vala. |
| **Astal IO VAPI** | In Nix store: `...-astal-io-0.1.vapi` | Authoritative API shape for Process, subprocess, exec. |

### Gnim (React-like GTK4 Framework)
| Resource | URL | What It's For |
|----------|-----|---------------|
| **Gnim GitHub** | https://github.com/Aylur/gnim | JSX for GTK4, signals, state management. Read the source when `For` / `With` / `createBinding` behave unexpectedly. |
| **Gnim Docs** | Check repo README and `docs/` | Component lifecycle, `onMount`, `onCleanup`, prop spreading. |
| **Gnim GObject** | `gnim/gobject` package | `@register`, `@getter`, `@setter` decorators. Essential for singleton services in `src/lib/`. |

### GTK 4 / Libadwaita / GJS
| Resource | URL | What It's For |
|----------|-----|---------------|
| **GTK 4 API Reference** | https://docs.gtk.org/gtk4/ | Widget props, CSS classes, signals. Search here first when a widget doesn't behave. |
| **Libadwaita API** | https://gnome.pages.gitlab.gnome.org/libadwaita/doc/ | `Adw.Window`, `Adw.PreferencesPage`, `Adw.ToggleGroup`, etc. |
| **GJS Guide** | https://gjs.guide/ | **The** GJS resource. Modules, imports, GObject patterns, memory management, promises, async/await in GJS. |
| **GJS GitHub** | https://github.com/GNOME/gjs | When the guide is unclear, check tests and source. |
| **Pango Markup** | https://docs.gtk.org/Pango/pango_markup.html | `tooltipMarkup`, label markup, supported tags. |
| **GTK CSS Overview** | https://docs.gtk.org/gtk4/css-properties.html | What CSS properties GTK supports. Not standard CSS! |
| **GSettings Docs** | https://docs.gtk.org/gio/class.Settings.html | Schema bindings, key types, range checks. |

### GObject Introspection (GIR)
| Resource | URL | What It's For |
|----------|-----|---------------|
| **GIR Spec** | https://gi.readthedocs.io/en/latest/ | Understanding how C/Vala APIs map to GJS. |
| **ts-for-gir** | https://github.com/gjsify/ts-for-gir | Generates TypeScript types from GIR. Run `pnpm run types` in Shade. |

---

## 2. Communities & Discussion

| Platform | Link / Search | What You Get |
|----------|---------------|--------------|
| **Aylur's Discord** | Check Astal GitHub for invite link | Real-time help from Aylur and other AGS devs. Best for "why does this crash?" questions. |
| **r/unixporn** | https://reddit.com/r/unixporn | Inspiration, rice showcases. Search "ags" or "astal" for screenshots with dotfiles. |
| **r/hyprland** | https://reddit.com/r/hyprland | Hyprland-specific configs, plugin recommendations. |
| **NixOS Discourse** | https://discourse.nixos.org/ | Nix packaging questions, GTK/GJS on NixOS. |
| **GNOME Matrix/Discourse** | https://discourse.gnome.org/ | GTK4/Libadwaita questions. GJS maintainers hang out here. |
| **GitHub Issues (Astal)** | https://github.com/Aylur/astal/issues | Bug reports, feature requests, workarounds. Search before posting. |
| **GitHub Issues (Gnim)** | https://github.com/Aylur/gnim/issues | Framework bugs, Reactivity edge cases. |

---

## 3. Reference Implementations — Study These

The best way to learn AGS/Astal is reading other people's shells. These are high-quality, actively maintained or historically significant.

### Full Desktop Shells (like Shade)

| Shell | Author | Tech | URL | What to Steal |
|-------|--------|------|-----|---------------|
| **matshell** | Matteo | AGS v2/v3, Material You | https://github.com/Axenide/Dots | Dynamic theming (matugen), media controls, workspace overview. Study the `widget/` structure. |
| **faiyt-ags** | faiyt | AGS v2, very polished | https://github.com/faityt/faiyt-ags | Launcher enhancements (calculator, emoji, clipboard search), window switcher, per-app volume. |
| **blxshell** | blx | AGS v2 | https://github.com/blxster/blxshell | Clipboard history in launcher, dock implementation. |
| **M3L6H Shell** | — | AGS v2 | Search r/unixporn | Good example of vertical bar layout. |
| **Khing Shell** | khing | AGS v2 | Search GitHub / r/unixporn | Lock screen design, notification center grouping. |

### Bars / Panels

| Project | Author | Tech | URL | What to Steal |
|---------|--------|------|-----|---------------|
| **HyprPanel** | Jas-SinghFSU | AGS v1 (GTK3) | https://github.com/Jas-SinghFSU/HyprPanel | **The** reference for integrated control center. Audio mixer, network manager, Bluetooth, power menu, calendar. Read even though it's GTK3 — the logic translates. |
| **Quickshell** | outfoxxed | Qt/QML | https://quickshell.org/ | Not AGS, but the architecture (services, widgets, config) is educational. Some of the most polished shells use this now. |
| **Waybar** | Alexays | C++ / GTK3 | https://github.com/Alexays/Waybar | Module architecture, CSS styling ideas, custom script patterns. |
| **ashell** | — | Rust / Iced | Search GitHub | Settings panel, power menu, privacy indicators. |

### Specific Widgets / Features

| Feature | Reference | Where to Look |
|---------|-----------|---------------|
| **Window Switcher / Alt-Tab** | `hyprshell` (formerly hyprswitch) | https://github.com/hyprwm/hyprswitch or custom AGS implementations in faiyt-ags |
| **Workspace Overview / Exposé** | Hyprspace plugin | https://github.com/KZDKM/Hyprspace or GNOME Shell's overview |
| **Dock / Taskbar** | `nwg-dock-hyprland` | https://github.com/nwg-piotr/nwg-dock-hyprland or dash-to-dock GNOME extension |
| **Clipboard Manager** | `cliphist` + wofi integration | Standard Hyprland dotfiles; faiyt-ags has native integration |
| **Screen Recording UI** | `wf-recorder` + AGS configs | matshell, blxshell |
| **Media Player Widget** | Astal MPRIS examples | Astal GitHub `examples/` folder |
| **Night Light** | `hyprsunset` | https://github.com/hyprwm/hyprsunset or `wlsunset` |
| **Idle Management** | `hypridle` | https://github.com/hyprwm/hypridle |
| **Polkit Agent** | `hyprpolkitagent` | https://github.com/hyprwm/hyprpolkitagent |

---

## 4. GNOME Shell Internals (The Gold Standard)

Since Shade aims for a GNOME-like experience, study how GNOME actually does it.

| Resource | URL | Notes |
|----------|-----|-------|
| **GNOME Shell Source** | https://gitlab.gnome.org/GNOME/gnome-shell | JavaScript/Clutter. Search for `panel.js`, `overview.js`, `messageTray.js`, `calendar.js`. |
| **GNOME Shell Extensions** | https://extensions.gnome.org/ | Install and inspect extensions to see how they modify the shell. "Dash to Dock", "Quick Settings Tweaks", "Caffeine", "Blur My Shell" are essential references. |
| **GNOME Shell CSS** | In `/usr/share/gnome-shell/gnome-shell.css` | See how GNOME styles panels, popovers, notifications. |
| **Muter Source** | https://gitlab.gnome.org/GNOME/mutter | The compositor. Read for understanding how window management works under the hood. |

---

## 5. Hyprland Ecosystem

| Resource | URL | Notes |
|----------|-----|-------|
| **Hyprland Wiki** | https://wiki.hyprland.org/ | Config syntax, variables, dispatchers, window rules. Essential. |
| **Hyprland Source** | https://github.com/hyprwm/Hyprland | When the wiki is unclear, read the source. |
| **Hyprland IPC** | https://wiki.hyprland.org/IPC/ | `hyprctl` and socket2 events. AstalHyprland wraps this — understand the raw protocol to debug issues. |
| **Awesome-Hyprland** | https://github.com/hyprland-community/awesome-hyprland | Curated list of tools, utilities, and rices. |
| **Hyprland Community** | https://github.com/hyprland-community | Tools like `hyprland-rs`, `hyprparser`, etc. |

---

## 6. Nix / NixOS Specific

| Resource | URL | Notes |
|----------|-----|-------|
| **Nixpkgs Manual** | https://nixos.org/manual/nixpkgs/stable/ | Packaging, `stdenv.mkDerivation`, `buildNpmPackage`, wrappers. |
| **NixOS Module System** | https://nixos.org/manual/nixos/stable/#sec-writing-modules | Writing `programs.shade` options properly. |
| **nixpkgs GTK/GJS packages** | Search https://search.nixos.org/packages | Check how other GTK4/GJS apps are packaged (e.g., `pano`, `fragments`, `clapper`). |
| **Home Manager GTK Module** | https://github.com/nix-community/home-manager | How to set GTK themes, fonts, icons via Nix. |
| **nix-ld / LD_PRELOAD** | https://github.com/nix-community/nix-ld | Alternative to `LD_PRELOAD` wrapper for gtk4-layer-shell. |

---

## 7. Tools for Development & Debugging

| Tool | How to Install | What It Does |
|------|---------------|--------------|
| **GTK Inspector** | `Ctrl+Shift+D` or `GTK_DEBUG=interactive` | Inspect GTK widget tree, CSS styles, properties in real-time. **Essential.** |
| **gtk4-icon-browser** | `gtk4-icon-browser` (in `gtk4.dev` usually) | Browse all available icon names. Verify icons before using them. |
| **d-spy** | `d-spy` | Browse D-Bus services, methods, signals. Debug fprintd, GeoClue, NetworkManager, etc. |
| **d-feet** | `d-feet` | Older D-Bus debugger, sometimes more stable than d-spy. |
| **GJS Console** | `gjs` | Interactive JS shell with GObject introspection. Test snippets: `gjs -c 'imports.gi.Gtk'` |
| **pw-cli / wpctl** | Comes with PipeWire | Debug audio endpoints, streams, volumes. |
| **nmcli** | Comes with NetworkManager | Debug WiFi, connections, active AP. |
| **bluetoothctl** | Comes with BlueZ | Debug Bluetooth adapter, devices, pairing. |
| **busctl** | Comes with systemd | Low-level D-Bus introspection. |
| **gio list / info / cat** | Comes with GLib | Debug GSettings schemas, files, mounts. |
| **gsettings** | Comes with GLib | Read/write settings, validate schemas. |

---

## 8. Blogs & Articles

| Author / Site | Topic | Link / Search |
|---------------|-------|---------------|
| **Aylur (Astal author)** | AGS/Gnim tutorials, examples | YouTube / GitHub discussions |
| **GNOME Developer Blog** | GTK4, Libadwaita patterns | https://blogs.gnome.org/ |
| **Emmanuele Bassi (GTK maintainer)** | GTK/GObject deep dives | https://ebassi.github.io/ |
| **Andy Holmes** | GJS, GObject, GNOME extensions | Various GNOME blog posts |
| **Maximiliano Sandoval** | Libadwaita, GNOME app dev | GNOME Circle developer |
| **r/unixporn Wiki** | Rice resources, tool comparisons | Sidebar links |
| **NixOS Wiki — GTK** | GTK theming on NixOS | https://wiki.nixos.org/wiki/GTK |
| **NixOS Wiki — Wayland** | Wayland compositor setup | https://wiki.nixos.org/wiki/Wayland |

---

## 9. Books & Long-Form Resources

| Title | Author | Topic | Notes |
|-------|--------|-------|-------|
| **GObject Introspection** | GNOME Project | GIR, language bindings | https://gi.readthedocs.io/ |
| **GTK 4 Tutorial** | GNOME Project | GTK app development | https://docs.gtk.org/gtk4/getting_started.html |
| **The Vala Tutorial** | GNOME Project | Vala language | Helpful for reading Astal source code |
| **JavaScript for GNOME** | GJS Team | GJS specifics | https://gjs.guide/guides/ |

---

## 10. Search Strategies

When you're stuck, search like this:

| Problem | Search Query |
|---------|-------------|
| Astal widget crashes | `site:github.com/Aylur/astal crash` or `astal "TypeError"` |
| GTK4 CSS not applying | `gtk4 css "not working"` or check GTK Inspector |
| GJS async/await issue | `gjs promise async await` or `gjs signal callback` |
| NetworkManager GJS | `gjs NetworkManager AccessPoint ssid` |
| Libadwaita widget behavior | `AdwToggleGroup active` or check Libadwaita API docs |
| Nix GTK app packaging | `nixpkgs gjs gtk4 package` or read `pano` derivation |
| Hyprland IPC event | `hyprland socket2 event workspace` |
| Icon name not found | `gtk4-icon-browser` or search `adwaita-icon-theme` source |

---

## 11. Shade-Specific Deep Dives

When you need to understand a specific Shade dependency, read these sources in order:

| Component | Read This | Why |
|-----------|-----------|-----|
| **AstalNetwork** | `lib/network/AstalNetwork.vala` in Astal repo | Understands `wifi.accessPoints` return type, `ssid`/`bssid` types |
| **AstalWp** | `lib/wireplumber/AstalWp.vala` | Audio streams, endpoints, volume APIs |
| **AstalMpris** | `lib/mpris/AstalMpris.vala` | Player properties, cover art, playback status |
| **AstalTray** | `lib/tray/AstalTray.vala` | SNI protocol, D-Bus menus |
| **AstalNotifd** | `lib/notifd/AstalNotifd.vala` | Notification actions, DND, grouping |
| **AstalHyprland** | `lib/hyprland/AstalHyprland.vala` | Workspace, client, monitor properties |
| **GWeather** | `libgweather` source / GIR | `GWeather.Info` methods, `get_value_sunset` behavior |
| **GTop** | `libgtop` docs | `glibtop_cpu`, `glibtop_mem`, `glibtop_fsusage` field meanings |

---

## 12. Recommended Reading Order for New Contributors

If someone wants to contribute to Shade, they should read in this order:

1. **GJS Guide** (chapters 1–3, 8, 10) — understand imports, GObject, async/await
2. **Astal Guide** — project structure, CLI, basic widgets
3. **Gnim README** — JSX patterns, `createState`, `createBinding`, `For`, `With`
4. **Shade `AGENTS.md`** — project conventions, build system, known pitfalls
5. **GTK 4 Widget Gallery** — know what widgets exist and their capabilities
6. **Libadwaita Demo** — run `adwaita-1-demo` to see all Adw widgets in action
7. **Study one reference shell** (matshell or faiyt-ags) — see how others structure `widget/` and `lib/`
8. **Read Astal source** for any service you plan to use — the Vala is the ultimate documentation

---

> **Last updated:** After full codebase audit  
> **Next review:** Quarterly or when Astal/Gnim releases a major version
