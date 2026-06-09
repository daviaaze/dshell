---
name: shade-shell
description: Complete reference for building and debugging GJS/GTK4 desktop shells with Astal and Gnim. Use when working on shade-shell or similar GJS-based desktop environments.
license: MIT
metadata:
  author: caioasmuniz
  version: "0.2.1"
---

# Shade — GJS Desktop Shell Development Guide

Shade is a personal desktop shell for Hyprland on Linux, written in TypeScript and rendered with GTK 4 / Libadwaita via GJS, using Astal and Gnim.

## When to Use

- Debugging GJS-based GTK4 applications
- Working with Astal (AyLur's toolkit) layer shell windows
- Writing GObject singletons with `gnim/gobject` decorators
- Building reactive UIs with Gnim (JSX for GTK4)
- Handling D-Bus remote commands via Gio.Application
- Debugging notification daemon conflicts on Linux desktops

## Essential Files

| File | Purpose |
|------|---------|
| `src/lib/logger.ts` | Shared logging utility with timestamps via `GLib.DateTime` |
| `src/lib/keyboard.ts` | Keyboard layout manager |
| `src/lib/shellState.ts` | Reactive GObject state singleton for launcher/qs/lockscreen |
| `src/lib/requestHandler.ts` | D-Bus CLI command dispatcher for remote Gio.Application calls |
| `src/lib/monitors.ts` | Reactive Gdk monitor tracking with Hyprland mapping |
| `src/widget/index.tsx` | Widget mount orchestrator with error isolation |
> For canonical file list, see AGENTS.md "Where to Find Things."

