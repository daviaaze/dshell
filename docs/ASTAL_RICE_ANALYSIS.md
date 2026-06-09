# Astal Rice Analysis: What Others Do Differently from Shade

> Research conducted on popular Astal/AGS v3 desktop shells to identify gaps and opportunities for Shade.

---

## Shells Studied

| Shell | Tech | Author | Stars | Key Differentiator |
|-------|------|--------|-------|-------------------|
| **matshell** | AGS v3, GTK4 | Neurarian | ~70 | Dynamic Material You theming, multimodal launcher |
| **faiyt-ags** | AGS v2, GTK4 | unfaiyted | — | Multi-AI chat, advanced evaluators, Signal stickers, monitor config |
| **colorshell** | AGS v3, GTK4 | retrozinndev | ~230 | Pywal16 dynamic theming, plugin-based launcher, i18n |
| **Ateon** | AGS v3, GTK4 | Youwes09 | — | Fork of matshell + wallpaper manager + clipboard manager |
| **HyprPanel** | AGS v1, GTK3 | Jas-SinghFSU | ~3k | Extremely configurable panel, audio mixer, dashboard, GUI settings |
| **daniqss/shell** | AGS v3, GTK4 | daniqss | — | Taskbar/dock implementation, simple and clean |
| **ags-bar (Grey-007)** | AGS v3, GTK4 | Grey-007 | — | Overview/workspace expose widget |

---

## 1. Dynamic Theming (Major Gap)

### What Others Do

**matshell** uses **matugen** for Material You dynamic theming:
- Generates color palettes from wallpaper using Material Color algorithm
- Hot-reloads themes on wallpaper change
- Templates for GTK3, GTK4, AGS SCSS, Hyprland, and hyprlock
- Supports `image-hct` for proper chroma/tone based theming
- Both light and dark variants generated automatically

**colorshell** uses **pywal16** for dynamic theming:
- Generates 16-color schemes from wallpaper
- Applies to shell, bar, widgets, and menus
- Environment variable `WALLPAPERS` for custom directories
- Wallpaper picker built into control center

**Ateon** (based on matshell) extends this with:
- Grid-based wallpaper browser with live preview
- Integration with matugen for full-system theming

### What Shade Does
- Shade has a basic day/night wallpaper switch based on color scheme
- Uses Libadwaita light/dark but **no dynamic color generation from wallpaper**
- Static CSS in `shade.css` and inline widget CSS

### Opportunity for Shade
- Integrate **matugen** or **pywal16** for dynamic theming
- Generate accent colors from wallpaper for a cohesive look
- Apply generated colors to GTK4 CSS, bar, quick settings, and lock screen
- This is a major visual differentiator in modern rices

---

## 2. Launcher / App Launcher (Significant Gap)

### What Others Do

**matshell** has a **Multimodal Fuzzy & Frecency Picker**:
- Apps, clipboard, wallpapers — all ranked by frequency + recency
- Based on gnofi picker concept
- Fuzzy search with smart ranking

**faiyt-ags** has the most advanced launcher in the ecosystem:
- **App Search** — Fuzzy matching with smart sorting
- **Math Evaluator** — Calculate expressions, unit conversions, percentages
- **Unit Converter** — Length, weight, temperature, time
- **Color Converter** — HEX, RGB, HSL
- **Base Converter** — Binary, octal, decimal, hexadecimal
- **Date/Time Calculator**
- **Directory Search** — Navigate filesystem
- **Clipboard History** — Search and paste from history
- **Process Killer** — Find and kill processes
- **Window Switcher** — Switch to open windows
- **Web Search** — Search via default browser
- **Signal Stickers** — Browse and copy stickers
- **Emoji Search** — Grid view with keyword matching
- **GIF Search** — Tenor API integration
- **Tmux Sessions** — List and attach to sessions
- **Browser Bookmarks** — Search Firefox/Zen bookmarks
- **Keyboard navigation** with vim-like bindings
- **Quick Actions** — Fast access to common operations

**colorshell** has an **Anyrun-style plugin-based launcher**:
- Prefix-based commands: `!` (shell), `>` (clipboard), `#` (wallpapers), `:` (media), `?` (web search)
- Plugin architecture for extensibility

### What Shade Does
- Basic fuzzy-searchable app grid anchored to the bar
- No evaluators, no clipboard search, no window switching, no web search
- No frecency ranking

### Opportunity for Shade
- Add **evaluators** (math, unit conversion, color conversion)
- Integrate **clipboard history** (via `cliphist` or `wl-clipboard`)
- Add **window switcher** in launcher (search open Hyprland windows)
- Add **frecency ranking** for apps
- Consider prefix-based search modes

---

## 3. Media Player & Audio Visualization

### What Others Do

**matshell** has extensive audio visualization:
- GTK4 Catmull-Rom spline widget for smooth visualizations
- Visualizer can be embedded in the bar or in a dedicated music widget
- Music cover theming (album art influences colors)

**faiyt-ags** has:
- Media player with interactive tooltip
- Album art with fallback placeholder
- Seekable progress bar with time display
- Simulated animation for remote players (e.g., Spotify Connect)

**colorshell** has:
- Media controls with player switching (scroll on widget)
- Center window with full media management

### What Shade Does
- Basic MPRIS media widget in quick settings expander
- No audio visualization
- No album art color extraction

### Opportunity for Shade
- Add seekable progress bar to media widget
- Consider album art theming influence

---

## 4. Workspace & Window Management (Gap)

### What Others Do

**faiyt-ags** has:
- **Workspace paging** — configurable workspaces per page (3-20)
- **Live window preview tooltip** on workspace hover
- **Click windows in tooltip to focus**
- **Middle-click windows to close** from tooltip
- **Window title display** in bar with app icon

**daniqss/shell** has:
- **Taskbar** — icon-only representation of running tasks
- Better workspaces widget

**ags-bar (Grey-007)** has:
- **Overview widget** — workspace expose/grid layout

**HyprPanel** has:
- **Taskbar module** — icon-only running tasks, optionally pinned launchers
- **Window grouping** — cycle focus between application windows
- **Pager module** — stylized preview of workspace contents
- Left-click launches pinned app or focuses running app
- Middle-click launches new instance

### What Shade Does
- Basic workspace indicators in bar
- No window previews, no taskbar, no window title display
- No workspace overview/exposé

### Opportunity for Shade
- Add **window title** display in bar
- Add **taskbar/dock** showing running applications
- Add **workspace overview/exposé** widget
- Add **window preview tooltips** on workspace hover

---

## 5. Quick Settings / System Menu Differences

### What Others Do

**matshell** has a minimal but clean system menu:
- WiFi scanning with connection management
- Bluetooth device pairing and management
- Brightness, audio, battery, power profiles
- Notification center with DND mode
- All in a unified panel

**faiyt-ags** has extensive sidebars:
- **Left Sidebar**: AI Chat panel
- **Right Sidebar**: System controls with tabbed interface
  - Audio Controls — Volume mixer and device selection
  - Bluetooth Manager — Device discovery and connection
  - WiFi Manager — Network scanning
  - Notification Center — Grouped with actions
  - Calendar Widget — Interactive calendar
  - System utilities

**colorshell** has a deep Control Center:
- **Interactive "Pages"** — click a tile to see sub-menu of devices
- Sliders for speaker, mic, brightness
- Tiles for screen recording, Bluetooth, night light, network, DND
- Pages expand into detailed device lists

**HyprPanel** has the most comprehensive menus:
- **Dashboard Menu** — System stats, shortcuts, power menu, directories
- **Audio Menu** — Volume levels and device selection (per-app volume!)
- **Media Menu** — Full playback controls
- **Network Menu** — WiFi list with signal strength
- **Bluetooth Menu** — Device list with pairing
- **Notifications Menu** — Grouped notifications
- **Calendar Menu** — Interactive calendar with weather
- **Energy Menu** — Battery and power profiles

### What Shade Does
- Quick settings panel with toggles, sliders, expanders
- Audio/mic/brightness sliders
- System tray, grouped notifications
- Battery, calendar, media, weather expanders
- **No per-app volume control**
- **No audio device selection UI**
- **No directory shortcuts in dashboard**

### Opportunity for Shade
- Add **per-app volume control** (AstalWp supports audio streams)
- Add **audio output/input device selector**
- Add **dashboard shortcuts** for common directories
- Consider **tabbed sidebar interface** instead of single panel

---

## 6. Screenshots & Screen Recording

### What Others Do

**faiyt-ags** has:
- Built-in **screen recording** with YouTube-quality presets
- **Screenshot capture** with annotation
- Recording indicator in bar when active
- Window capture tools

**colorshell** has:
- Screen recording tile in control center
- Integration with recording tools

**matshell** has:
- Screen recording UI references
- wf-recorder integration patterns

### What Shade Does
- Shade has NO built-in screenshot or recording UI
- AGENTS.md mentions `wf-recorder` patterns for controllable subprocesses

### Opportunity for Shade
- Add **screenshot tool** (grim/slurp integration)
- Add **screen recording UI** with start/stop controls
- Show **recording indicator** in bar when active
- Consider area/window/output selection modes

---

## 7. Notifications

### What Others Do

**matshell** has:
- Notification center with intuitive management
- DND mode toggle
- Grouped notifications

**faiyt-ags** has:
- Popup notifications grouped by application
- Stack from top-right (up to 5)
- Auto-dismiss after 5 seconds with progress indicator
- Pause timer on hover
- App-specific icons

**colorshell** has:
- Notification history
- Application actions support

**HyprPanel** has:
- Configurable notification position and timeout
- Which monitor to display on
- Follow focused monitor option
- Preserve actions between sessions
- Application ignore list

### What Shade Does
- Notification popups (top-right) with auto-dismiss
- Grouped notifications in quick settings
- Basic DND support
- **No notification history**
- **No per-app ignore list**
- **No pause-on-hover**

### Opportunity for Shade
- Add **notification history** / persistent log
- Add **pause-on-hover** for popups
- Add **per-app notification settings**
- Consider **notification progress indicator** for auto-dismiss

---

## 8. Settings / Configuration UI

### What Others Do

**faiyt-ags** has the most advanced settings:
- **Full GUI configuration** with searchable settings
- **Theme Manager** — Built-in themes, custom theme editor, live preview, HSL color picker
- **Monitor Configuration** — Drag-and-drop monitor positioning, resolution, scale, rotation
- **Bar Modules** — Toggle individual modules
- **Quick Toggles** — Configure sidebar toggles
- **Animation settings** — Duration and choreography
- **Keyboard Shortcuts Viewer**
- All settings persist to JSON, apply immediately without restart

**colorshell** has:
- Config file for behavior customization
- Nix flake support

**HyprPanel** has:
- GUI settings dialog accessible from dashboard
- Extremely granular configuration (300+ options)
- Home Manager module for Nix
- Theme switching via CLI

### What Shade Does
- Libadwaita preferences window (General, Bar, Weather tabs)
- GSettings-based with reactive schema
- **No live theme editing**
- **No monitor configuration UI**
- **No module toggle UI**
- **No searchable settings**

### Opportunity for Shade
- Add **searchable settings**
- Add **module toggle UI** to enable/disable bar components
- Add **theme editor/preview**
- Consider **monitor arrangement visualizer**

---

## 9. Internationalization (i18n)

### What Others Do

**colorshell** has full i18n support:
- Automatic language matching with system locale
- Support for: English, Portuguese (BR), Russian, French, Turkish, Japanese
- Community-maintained translations

### What Shade Does
- Shade has NO i18n support
- English-only UI

### Opportunity for Shade
- Add gettext-based i18n infrastructure
- Extract translatable strings
- Support at least Portuguese (author's native language)

---

## 10. AI Integration

### What Others Do

**faiyt-ags** has multi-AI chat integration:
- Claude, GPT, Gemini, and Ollama support
- Model selection
- Conversation sidebar
- Markdown rendering with syntax highlighting
- Code block support
- Settings for API keys

**sh1zicus Hyprland** (End-4 fork) has:
- Built-in AI Assistant sidebar
- ChatGPT and Google Gemini integration
- Image generation support

### What Shade Does
- No AI integration

### Opportunity for Shade
- Consider AI chat panel (low priority, but trendy)
- Could be a sidebar tab like faiyt-ags

---

## 11. Clipboard Management

### What Others Do

**matshell** has:
- Clipboard history in multimodal launcher
- Integration with `cliphist` and `wl-clipboard`

**faiyt-ags** has:
- Clipboard history management with search
- Content preview
- Integration in launcher with `>` prefix

**colorshell** has:
- Clipboard search via `>` prefix in launcher
- Clipboard history plugin

### What Shade Does
- No clipboard manager integration

### Opportunity for Shade
- Integrate `cliphist` or `wl-clipboard` for history
- Add clipboard search to launcher
- Show clipboard preview in quick settings or launcher

---

## 12. Dock / Taskbar

### What Others Do

**daniqss/shell** has:
- Simple taskbar showing running applications
- Icon-only representation

**HyprPanel** has:
- Taskbar module with pinned applications
- Window grouping
- Context menus on right-click

### What Shade Does
- No dock or taskbar
- Only workspace indicators

### Opportunity for Shade
- Add optional **dock/taskbar** widget
- Show running applications with icons
- Support pinned favorites
- Could be a separate widget or integrated into bar

---

## 13. Keyboard Navigation & Hints

### What Others Do

**faiyt-ags** has Flash.nvim-style keyboard navigation:
- Press `Ctrl+Space` to activate hint mode
- Letter badges appear on all clickable elements
- Type letter(s) to click element
- Scope-aware hints (single-letter for common, two-letter for many)
- Supported across all panels

### What Shade Does
- No keyboard hint navigation
- Basic keyboard shortcuts for toggling panels

### Opportunity for Shade
- Add **keyboard hint navigation** for mouse-less control
- Particularly useful for quick settings and bar

---

## 14. Bar Modules & Customization

### What Others Do

**faiyt-ags** has highly modular bar:
- Toggle individual modules via settings
- System resources with circular progress (RAM, swap, CPU, network, GPU)
- GPU usage and temperature (NVIDIA)
- CPU temperature
- Mic mute indicator with click-to-unmute
- Color picker utility button
- Wallpaper picker utility button
- Screenshot/recording buttons
- Bar corner decorations (rounded corners)

**HyprPanel** has:
- 15+ standard modules + 15+ basic modules
- Custom module configuration
- Mouse actions configurable per module (left/right/middle/scroll)
- Menu spawning from any module
- CPU temperature, RAM, storage, netstat modules
- Updates checker module
- Weather module
- Submap indicator
- Hypridle/hyprsunset toggles

### What Shade Does
- Fixed bar layout with limited customization
- Workspaces, system usage, clock, weather, system indicators
- **No modular toggle UI**
- **No GPU monitoring**
- **No network speed indicators**
- **No CPU temperature**

### Opportunity for Shade
- Add **modular bar system** — toggle modules on/off
- Add **system resource monitors** (RAM, CPU temp, network speed)
- Add **GPU monitoring** (optional)
- Add **utility buttons** (screenshot, color picker, etc.)

---

## 15. Build & Architecture Patterns

### What Others Do

**matshell** uses:
- AGS v3 with GTK4
- `dart-sass` for SCSS compilation
- matugen templates for dynamic theming
- Nix flake with home-manager module
- Config JSON for user customization

**faiyt-ags** uses:
- Bun + Vite build system (instead of esbuild)
- Tailwind CSS with GTK4 compatibility patches
- TypeScript with full type checking
- SCSS for complex styling
- JSON configuration with hot reload
- Advanced logging with source maps
- Source map support for debugging

**colorshell** uses:
- AGS v3, TypeScript
- Pywal16 for theming
- Plugin-based launcher architecture
- i18n with gettext
- Nix flake support

### What Shade Does
- esbuild + Meson build system
- Minimal global CSS + inline widget CSS
- GSettings for configuration
- No hot reload for styles
- No JSON config overlay

### Opportunity for Shade
- Consider **SCSS compilation** for more maintainable styles
- Add **JSON config overlay** on top of GSettings
- Add **style hot reload** for development
- Improve **debugging experience** with source maps

---

## Summary: Top Opportunities for Shade

### High Impact, Achievable
1. **Dynamic Theming** — matugen/pywal16 integration for wallpaper-based colors
2. **Launcher Evaluators** — Math, unit conversion, color conversion, clipboard search
3. **Per-App Volume** — Audio stream controls via AstalWp
4. **Audio Device Selector** — Output/input device switching
5. **Notification History** — Persistent notification log
6. **Module Toggle UI** — Enable/disable bar components in settings
7. **Window Title in Bar** — Show active window title + app icon

### Medium Impact, Moderate Effort
8. **Clipboard History** — Integrate cliphist/wl-clipboard in launcher
9. **Screenshot/Recording UI** — Grim/slurp/wf-recorder integration
11. **Workspace Overview** — Grid expose of workspaces and windows
12. **Dashboard Shortcuts** — Quick directory/app shortcuts in quick settings
13. **System Resource Monitors** — RAM, CPU temp, network speed in bar
14. **Searchable Settings** — Filter settings by keyword

### Lower Priority / Nice to Have
15. **Taskbar/Dock** — Running app icons
16. **Keyboard Hint Navigation** — Flash.nvim-style element hints
17. **i18n Support** — Portuguese, etc.
18. **AI Chat Panel** — Claude/GPT integration
19. **Monitor Config UI** — Visual monitor arrangement
20. **Theme Editor** — Live color customization

---

## References

- matshell: https://github.com/Neurarian/matshell
- faiyt-ags: https://github.com/unfaiyted/faiyt-ags
- colorshell: https://github.com/retrozinndev/colorshell
- Ateon: https://github.com/Youwes09/Ateon
- HyprPanel: https://github.com/Jas-SinghFSU/HyprPanel
- daniqss/shell: https://github.com/daniqss/shell
- ags-bar: https://github.com/Grey-007/ags-bar

---

> **Last updated:** 2026-04-29
> **Next review:** After implementing 3+ features from this list
