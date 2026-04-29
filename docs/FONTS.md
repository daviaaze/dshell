# Typography Guide for Shade / Astal / GTK4 Shells

> GTK4/Libadwaita shells inherit the system font by default, but strategic font choices dramatically improve perceived quality. This guide covers what to use and where.

---

## 1. Understanding the Constraint

Shade uses **real GTK4 widgets** (`Gtk.Label`, `Adw.ButtonContent`, etc.), not canvas-rendered text like Eww or Waybar. This means:

- **You don't set fonts per-widget** like `font: "14px JetBrainsMono"` in CSS
- **Font rendering is handled by Pango/GTK**, not your shell
- **You change fonts via GTK CSS** (`font-family`) or system GSettings (`org.gnome.desktop.interface font-name`)
- **Libadwaita has strong opinions** — it uses Cantarell/Adwaita Sans by default and expects specific weights/sizes

So "font choice" for Shade means: picking the right system font stack and using CSS overrides where appropriate.

---

## 2. System UI Font (The Big One)

This controls 90% of the text in your shell — bar labels, quick settings, notifications, clock, etc.

### Current GNOME/GTK4 Default
- **Adwaita Sans** (newer GTK4.16+ / GNOME 47+) — humanist sans, replaces Cantarell
- **Cantarell** — traditional GNOME font, still widely used

### Better Alternatives

| Font | Style | Why Use It | Nix Package |
|------|-------|-----------|-------------|
| **Inter** | Geometric sans | Extremely legible at small sizes, neutral, pairs well with anything. The most popular modern UI font in Linux ricing. | `inter` |
| **Geist** | Geometric sans | Vercel's font. Clean, slightly technical feel. Variable weight. Good for bars. | `geist-font` |
| **Manrope** | Geometric sans | Round, friendly, modern. Good for a "soft" aesthetic. | `manrope` |
| **Outfit** | Geometric sans | Very round, almost playful. Good for bold statements. | `outfit` |
| **Plus Jakarta Sans** | Geometric sans | Professional, slightly condensed. Excellent for status bars with limited space. | `plus-jakarta-sans` |
| **Rubik** | Geometric sans | Slightly quirky, distinctive. | `rubik` |
| **DM Sans** | Neo-grotesque | Clean, neutral, Google Fonts staple. | `dm-sans` |
| **Jost** | Geometric sans | Futura-like, elegant. | `jost` |

### For a "GNOME but better" Look
Keep the system font (Cantarell/Adwaita Sans) but improve the **monospace companion** for numbers and technical readouts:

| Font | Use For | Nix Package |
|------|---------|-------------|
| **JetBrains Mono** | Code, terminals, bar numbers | `jetbrains-mono` |
| **Geist Mono** | Technical readouts, very clean | `geist-font` |
| **IBM Plex Mono** | Professional, legible at tiny sizes | `ibm-plex` |
| **SF Mono** | Apple's font, excellent for numbers | (manual install) |
| **Cascadia Code / Mono** | Microsoft's font, very readable | `cascadia-code` |
| **Maple Mono** | Cute, distinctive, ligatures | `maple-mono` |
| **Fira Code** | Classic, tons of ligatures | `fira-code` |
| **Iosevka** | Ultra-condensed, fits maximum text in minimum space | `iosevka` |

---

## 3. Where to Apply Fonts in Shade

### Option A: System-Wide (Recommended)

Set via GSettings so GTK4, Libadwaita, and all apps pick it up:

```nix
# In your NixOS module or home-manager
fonts.packages = with pkgs; [ inter jetbrains-mono ];

# Set GTK default fonts
gtk = {
  font = {
    name = "Inter 11";
    package = pkgs.inter;
  };
};
```

Or via gsettings in the shell:
```ts
// In App.tsx or a font service
const interfaceSettings = new Gio.Settings({ schemaId: "org.gnome.desktop.interface" })
interfaceSettings.set_string("font-name", "Inter 11")
interfaceSettings.set_string("monospace-font-name", "JetBrains Mono 10")
interfaceSettings.set_string("document-font-name", "Inter 11")
```

### Option B: CSS Override (Per-Component)

In `src/shade.css` or inline `css` props:

```css
/* Apply Inter to the entire shell */
.background {
  font-family: "Inter", "Cantarell", sans-serif;
}

/* Use monospace for system stats */
.system-usage-label {
  font-family: "JetBrains Mono", monospace;
  font-feature-settings: "tnum";
  /* tabular numbers = aligned digits */
}

/* Clock with tabular nums so digits don't jump */
.clock-label {
  font-family: "Inter", sans-serif;
  font-feature-settings: "tnum";
}
```

**Where this makes sense in Shade:**
- `bar/systemUsage.tsx` — CPU/RAM percentages with tabular numbers (`font-feature-settings: "tnum"`)
- `bar/clock.tsx` — time digits that update every second (tabular nums prevent jitter)
- `bar/workspaces.tsx` — workspace numbers
- `quicksettings/expander/worldClock.tsx` — timezone offsets

### Option C: Adwaita Styles with Custom CSS

Libadwaita uses CSS classes like `title-1`, `heading`, `body`, `caption`. You can override the font-family for these:

```css
.title-1, .title-2, .title-3, .heading {
  font-family: "Inter", sans-serif;
  font-weight: 600;
}

.body, .caption {
  font-family: "Inter", sans-serif;
}
```

---

## 4. Icon Fonts / Nerd Fonts

Shade uses **GTK icon names** (`Gtk.Image iconName="..."`) rather than font icons. This is actually better — you get proper symbolic icons that follow the theme and respect dark/light modes.

**However**, if you ever want font-based icons (some AGS rices do this):

| Font | Notes | Nix Package |
|------|-------|-------------|
| **Symbols Nerd Font** | Just the icons, no patched text font. Use alongside your UI font. | `nerd-fonts.symbols-only` |
| **JetBrainsMono Nerd Font** | Monospace + icons. Good if your bar uses text-based widgets. | `nerd-fonts.jetbrains-mono` |
| **FiraCode Nerd Font** | Another popular patched mono. | `nerd-fonts.fira-code` |

**For Shade specifically:** You probably don't need Nerd Fonts since you use `Gtk.Image` with Adwaita icons. But if you ever want to display a custom icon inline with text (e.g., a weather icon next to temperature without using `Gtk.Image`), Symbols Nerd Font is useful.

---

## 5. Emoji Fonts

GTK4 apps need an emoji font or you'll get black-and-white fallback glyphs.

| Font | Style | Nix Package |
|------|-------|-------------|
| **Noto Color Emoji** | Google's emoji, default on most Linux | `noto-fonts-color-emoji` |
| **Apple Color Emoji** | Apple's emoji (manual install) | — |
| **Twemoji** | Twitter's emoji set | `twemoji-color-font` |
| **Fluent UI Emoji** | Microsoft's emoji | — |

**NixOS:**
```nix
fonts.packages = with pkgs; [ noto-fonts-color-emoji ];
```

---

## 6. Variable Fonts

Variable fonts have a `wght` axis (weight) from thin to black. They're great for animation and responsive design.

| Font | Axes | Use Case |
|------|------|----------|
| **Inter Variable** | `wght` (100-900) | Smooth weight transitions in UI |
| **Geist Variable** | `wght` | Modern tech feel |
| **Roboto Flex** | `wght`, `wdth`, `slnt`, `opsz` | Extremely flexible |
| **Open Sans Variable** | `wght`, `wdth` | Safe, readable |

**In GTK CSS:**
```css
/* Variable font with specific weight */
.dynamic-label {
  font-family: "Inter Variable", sans-serif;
  font-variation-settings: "wght" 450;
}
```

**Caveat:** GTK4/Pango variable font support is decent but not perfect. Test before committing.

---

## 7. Recommended Font Stack for Shade

If you want a cohesive, modern look without looking like every other rice:

### "Clean & Professional"
```
UI:        Inter 11
Mono:      JetBrains Mono 10
Emoji:     Noto Color Emoji
Terminal:  JetBrains Mono 11
```

### "Technical & Minimal"
```
UI:        Geist Sans 11
Mono:      Geist Mono 10
Emoji:     Noto Color Emoji
Terminal:  Geist Mono 11
```

### "GNOME Native but Better"
```
UI:        Adwaita Sans / Cantarell 11 (keep default)
Mono:      IBM Plex Mono 10
Emoji:     Noto Color Emoji
Terminal:  IBM Plex Mono 11
```

### "Distinctive / Riced"
```
UI:        Plus Jakarta Sans 11
Mono:      Maple Mono 10
Emoji:     Twemoji
Terminal:  Maple Mono 11
```

---

## 8. Implementation in Shade

### Step 1: Add fonts to NixOS module

```nix
# nix/module.nix
config = mkIf cfg.enable {
  fonts.packages = with pkgs; [
    inter
    jetbrains-mono
    noto-fonts-color-emoji
  ];
  # ... rest of config
};
```

### Step 2: Load CSS with font declarations

In `src/shade.css`:

```css
/* Use Inter for the shell, fallback to system */
* {
  font-family: "Inter", "Adwaita Sans", "Cantarell", sans-serif;
}

/* Tabular numbers for anything that updates frequently */
.clock-time,
.system-usage-value,
.workspace-label,
.battery-percentage {
  font-feature-settings: "tnum";
}
```

### Step 3: Add CSS classes to widgets

In `bar/clock.tsx`:
```tsx
<Gtk.Label
  cssClasses={["title-1", "numeric", "clock-time"]}
  // numeric = tabular numbers in GTK
/>
```

In `bar/systemUsage.tsx`:
```tsx
<Gtk.Label
  cssClasses={["caption", "numeric", "system-usage-value"]}
/>
```

GTK has a built-in `.numeric` class that enables tabular numbers for many fonts.

---

## 9. What Other AGS Shells Use

| Shell | UI Font | Mono Font | Notes |
|-------|---------|-----------|-------|
| **matshell** | Inter | JetBrains Mono | Material You themed |
| **faiyt-ags** | Geist | Geist Mono | Very modern, clean |
| **blxshell** | Outfit | Maple Mono | Round, playful |
| **HyprPanel** | System default | System default | Uses SCSS theming |
| **GNOME Shell** | Cantarell / Adwaita Sans | System mono | Native |

---

## 10. Quick Nix Reference

```nix
# flake.nix or module.nix
fonts.packages = with pkgs; [
  # UI fonts
  inter
  geist-font
  manrope
  plus-jakarta-sans
  
  # Monospace
  jetbrains-mono
  ibm-plex
  cascadia-code
  maple-mono
  iosevka
  
  # Icons (optional for Shade)
  nerd-fonts.symbols-only
  
  # Emoji
  noto-fonts-color-emoji
  twemoji-color-font
];
```

---

## 11. One-Line Improvements You Can Make Now

1. **Enable tabular numbers on the clock** — prevents digit width jitter when `59` → `00`
2. **Use a monospace font for system stats** — CPU/RAM/disk readouts look more precise
3. **Keep UI font at 10–11pt** — Libadwaita widgets expect this range; smaller breaks alignment
4. **Don't use thin weights (100–200) for UI text** — they render poorly at small sizes on low-DPI screens
5. **Test on both 96dpi and 144dpi+** — fonts that look crisp on HiDPI can be illegible on standard monitors
