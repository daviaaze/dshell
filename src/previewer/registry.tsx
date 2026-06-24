/**
 * Component registry for the Gnim/GJS UI Previewer (Storybook).
 *
 * Each entry defines a component name, category, description, default props,
 * and a factory function that returns the Gnim JSX element.
 *
 * To add a new component, import it and add an entry to the `entries` array.
 * Provide sensible default/mock props so the component renders standalone.
 */

import Gtk from "gi://Gtk?version=4.0"
import { IconNames } from "#/lib/iconNames"

import { ActionButton } from "#/widget/common/actionButton"
import { IconButton, IconMenuButton } from "#/widget/common/iconButton"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedBox } from "#/widget/common/linkedBox"
import { SunArc } from "#/widget/common/sunArc"
import { IconInfoRow } from "#/widget/common/iconInfoRow"
import { PowerMenu } from "#/widget/common/powerMenu"
import { MockSlider } from "./mockSlider"
import { MockNotification } from "./mocks/mockNotification"
import { MockWeatherWidget } from "./mocks/mockWeatherWidget"
import { MockWeatherIcon } from "./mocks/mockWeatherIcon"
import { MockAudioControl } from "./mocks/mockAudioControl"

export interface ComponentPreset {
  /** Display name (e.g. "Critical Alert") */
  name: string
  /** Optional description */
  description?: string
  /** Props to apply */
  props: Record<string, unknown>
}

export interface ComponentEntry {
  /** Display name in the sidebar */
  name: string
  /** Category group for organisation */
  category: string
  /** Optional one-line description */
  description: string
  /** Factory that returns a Gnim JSX node given props */
  render: (props: Record<string, unknown>) => unknown
  /** Default props used when previewing this component */
  defaultProps: Record<string, unknown>
  /** Editable prop keys the user can tweak at runtime */
  editableProps?: Record<string, PropDef>
  /** Named preset configurations (like Storybook stories) */
  presets?: ComponentPreset[]
}

export interface PropDef {
  type: "string" | "boolean" | "number" | "select" | "icon"
  label: string
  default: unknown
  /** For "select" type: array of options */
  options?: string[]
  /** For "number" type */
  min?: number
  max?: number
  step?: number
}

// ── Component Entries ────────────────────────────────────────────────────────

export const entries: ComponentEntry[] = [
  // ── Common / Buttons ───────────────────────────────────────────────────
  {
    name: "ActionButton",
    category: "Buttons",
    description: "Flat menu-item button with icon + label",
    render: (p: Record<string, unknown>) =>
      ActionButton({
        iconName: p.iconName as string,
        label: p.label as string,
        destructive: p.destructive as boolean,
        onClicked: () => print("[ActionButton] clicked"),
      }),
    defaultProps: {
      iconName: IconNames.systemShutdown,
      label: "Power Off",
      destructive: false,
    },
    editableProps: {
      iconName: { type: "icon", label: "Icon", default: IconNames.systemShutdown },
      label: { type: "string", label: "Label", default: "Power Off" },
      destructive: { type: "boolean", label: "Destructive", default: false },
    },
  },

  {
    name: "IconButton",
    category: "Buttons",
    description: "Circular icon button",
    render: (p: Record<string, unknown>) =>
      IconButton({
        icon: p.icon as string,
        tooltipText: p.tooltipText as string,
        onClicked: () => print("[IconButton] clicked"),
      }),
    defaultProps: {
      icon: IconNames.faceSmile,
      tooltipText: "Click me!",
    },
    editableProps: {
      icon: { type: "icon", label: "Icon", default: IconNames.faceSmile },
      tooltipText: { type: "string", label: "Tooltip", default: "Click me!" },
    },
  },

  {
    name: "IconMenuButton",
    category: "Buttons",
    description: "Circular button with a popover menu",
    render: (p: Record<string, unknown>) =>
      IconMenuButton({
        icon: p.icon as string,
        tooltipText: p.tooltipText as string,
        popover: (
          <Gtk.Popover>
            <Gtk.Label label={p.popoverText as string} marginTop={12} marginBottom={12} />
          </Gtk.Popover>
        ) as Gtk.Popover,
      }),
    defaultProps: {
      icon: IconNames.openMenu,
      tooltipText: "Opens a popover",
      popoverText: "Popover content here",
    },
    editableProps: {
      icon: { type: "icon", label: "Icon", default: IconNames.openMenu },
      tooltipText: {
        type: "string",
        label: "Tooltip",
        default: "Opens a popover",
      },
    },
  },

  {
    name: "QuickToggleButton",
    category: "Buttons",
    description: "Toggable action button (Adw.SplitButton or Gtk.Button)",
    render: (p: Record<string, unknown>) =>
      QuickToggleButton({
        icon: p.icon as string,
        label: p.label as string,
        onClick: () => print("[QuickToggleButton] clicked"),
      }),
    defaultProps: {
      icon: IconNames.networkWireless,
      label: "Wi-Fi",
    },
    editableProps: {
      icon: { type: "icon", label: "Icon", default: IconNames.networkWireless },
      label: { type: "string", label: "Label", default: "Wi-Fi" },
    },
  },

  // ── Common / Widgets ───────────────────────────────────────────────────
  {
    name: "LinkedBox",
    category: "Containers",
    description:
      "Container that applies the 'linked' CSS class to group buttons visually",
    render: () =>
      LinkedBox({
        children: [
          <Gtk.Button label="Item A" cssClasses={["raised"]} />,
          <Gtk.Button label="Item B" cssClasses={["raised"]} />,
          <Gtk.Button label="Item C" cssClasses={["raised"]} />,
        ],
      }),
    defaultProps: {},
  },

  {
    name: "IconInfoRow",
    category: "Containers",
    description: "Row with icon, primary text and optional secondary text",
    render: (p: Record<string, unknown>) =>
      IconInfoRow({
        icon: p.icon as string,
        primary: p.primary as string,
        secondary: p.secondary as string,
        pixelSize: p.pixelSize as number,
      }),
    defaultProps: {
      icon: IconNames.avatarDefault,
      primary: "John Doe",
      secondary: "Online",
      pixelSize: 20,
    },
    editableProps: {
      icon: { type: "icon", label: "Icon", default: IconNames.avatarDefault },
      primary: { type: "string", label: "Primary", default: "John Doe" },
      secondary: { type: "string", label: "Secondary", default: "Online" },
      pixelSize: { type: "number", label: "Icon size", default: 20, min: 8, max: 64, step: 2 },
    },
  },

  // ── Visual / Graphical ─────────────────────────────────────────────────
  {
    name: "SunArc",
    category: "Visual",
    description:
      "Custom drawing of sun arc with sunrise/sunset/moon phase",
    render: (p: Record<string, unknown>) =>
      SunArc({
        sunrise: () => p.sunrise as number,
        sunset: () => p.sunset as number,
        now: () => p.now as number,
        moonPhase: p.showMoon
          ? () => ({
              phase: 0.5,
              phaseName: "Full Moon",
              phaseEmoji: "🌕",
            })
          : undefined,
      }),
    defaultProps: {
      sunrise: 6 * 3600, // 06:00
      sunset: 18 * 3600, // 18:00
      now: 12 * 3600, // noon
      showMoon: false,
    },
    editableProps: {
      sunrise: { type: "number", label: "Sunrise (epoch)", default: 6 * 3600, min: 0, max: 86400 },
      sunset: { type: "number", label: "Sunset (epoch)", default: 18 * 3600, min: 0, max: 86400 },
      now: { type: "number", label: "Current time (epoch)", default: 12 * 3600, min: 0, max: 86400 },
      showMoon: { type: "boolean", label: "Show moon? (night)", default: false },
    },
    presets: [
      { name: "Morning", description: "Sun rising", props: { sunrise: 6 * 3600, sunset: 18 * 3600, now: 7 * 3600, showMoon: false } },
      { name: "Noon", description: "Sun at peak", props: { sunrise: 6 * 3600, sunset: 18 * 3600, now: 12 * 3600, showMoon: false } },
      { name: "Evening", description: "Sun setting", props: { sunrise: 6 * 3600, sunset: 18 * 3600, now: 17 * 3600, showMoon: false } },
      { name: "Night", description: "Past sunset, moon visible", props: { sunrise: 6 * 3600, sunset: 18 * 3600, now: 21 * 3600, showMoon: true } },
    ],
  },

  // ── Common / Controls ──
  {
    name: "PowerMenu",
    category: "Controls",
    description:
      "Power action menu: lock, suspend, reboot, shutdown",
    render: () => PowerMenu(),
    defaultProps: {},
  },

  {
    name: "Slider",
    category: "Controls",
    description:
      "Volume/brightness slider (mock, uses Gtk.Scale instead of Astal.Slider)",
    render: (p: Record<string, unknown>) =>
      MockSlider({
        icon: p.icon as string,
        value: p.value as number,
        min: p.min as number,
        max: p.max as number,
        showLabel: p.showLabel as boolean,
      }),
    defaultProps: {
      icon: IconNames.audioVolumeHigh,
      value: 65,
      min: 0,
      max: 100,
      showLabel: true,
    },
    editableProps: {
      icon: { type: "icon", label: "Icon", default: IconNames.audioVolumeHigh },
      value: { type: "number", label: "Value", default: 65, min: 0, max: 100 },
      min: { type: "number", label: "Min", default: 0, max: 99 },
      max: { type: "number", label: "Max", default: 100, min: 1, max: 200 },
      showLabel: { type: "boolean", label: "Show % label", default: true },
    },
  },

  // ── Notifications ────────────────────────────────────────────────────
  {
    name: "Notification",
    category: "Notifications",
    description:
      "Toast notification card: app icon, summary, body, progress, actions",
    render: (p: Record<string, unknown>) =>
      MockNotification({
        appName: p.appName as string,
        appIcon: p.appIcon as string,
        summary: p.summary as string,
        body: p.body as string,
        urgency: p.urgency as "normal" | "critical" | "low",
        showActions: p.showActions as boolean,
        showProgress: p.showProgress as boolean,
        hasImage: p.hasImage as boolean,
      }),
    defaultProps: {
      appName: "Spotify",
      appIcon: IconNames.applicationsMultimedia,
      summary: "Now Playing",
      body: "Bohemian Rhapsody — Queen",
      urgency: "normal",
      showActions: true,
      showProgress: true,
      hasImage: false,
    },
    editableProps: {
      appIcon: { type: "icon", label: "App icon", default: IconNames.applicationsMultimedia },
      appName: { type: "string", label: "App name", default: "Spotify" },
      summary: { type: "string", label: "Summary", default: "Now Playing" },
      body: { type: "string", label: "Body", default: "Bohemian Rhapsody — Queen" },
      urgency: { type: "select", label: "Urgency", default: "normal", options: ["low", "normal", "critical"] },
      showActions: { type: "boolean", label: "Show actions", default: true },
      showProgress: { type: "boolean", label: "Progress bar", default: true },
      hasImage: { type: "boolean", label: "Has image", default: false },
    },
  },

  // ── Weather ───────────────────────────────────────────────────────────
  {
    name: "WeatherIcon",
    category: "Weather",
    description:
      "Compact weather icon + temperature label",
    render: (p: Record<string, unknown>) =>
      MockWeatherIcon({
        iconName: p.iconName as string,
        temp: p.temp as string,
      }),
    defaultProps: {
      iconName: IconNames.weatherOvercast,
      temp: "22°",
    },
    editableProps: {
      iconName: { type: "icon", label: "Icon", default: IconNames.weatherOvercast },
      temp: { type: "string", label: "Temperature", default: "22°" },
    },
  },

  {
    name: "WeatherWidget",
    category: "Weather",
    description:
      "Full weather popover: gradient, sun arc, hourly + daily forecast, details",
    render: (p: Record<string, unknown>) =>
      MockWeatherWidget({
        temperature: p.temperature as number,
        showForecast: p.showForecast as boolean,
        showSunArc: p.showSunArc as boolean,
        showDetails: p.showDetails as boolean,
      }),
    defaultProps: {
      temperature: 22,
      showForecast: true,
      showSunArc: true,
      showDetails: true,
    },
    editableProps: {
      temperature: { type: "number", label: "Temp °C", default: 22, min: -20, max: 50 },
      showForecast: { type: "boolean", label: "Show forecast", default: true },
      showSunArc: { type: "boolean", label: "Show sun arc", default: true },
      showDetails: { type: "boolean", label: "Show details", default: true },
    },
    presets: [
      { name: "Default (22°C)", description: "Full weather display", props: { temperature: 22, showForecast: true, showSunArc: true, showDetails: true } },
      { name: "Night (15°C)", description: "Compact night view", props: { temperature: 15, showForecast: false, showSunArc: false, showDetails: true } },
      { name: "Hot (38°C)", description: "Forecast only", props: { temperature: 38, showForecast: true, showSunArc: false, showDetails: false } },
      { name: "Cold (2°F)", description: "Minimal view", props: { temperature: 2, showForecast: false, showSunArc: false, showDetails: false } },
    ],
  },

  // ── Audio ──
  {
    name: "AudioControl",
    category: "Controls",
    description:
      "Audio device control: volume slider, mute toggle, device list",
    render: () =>
      MockAudioControl({
        volume: 75,
        deviceName: "Built-in Audio",
      }),
    defaultProps: {},
  },
]

/** Lookup a component entry by name (case-insensitive) */
export function findEntry(name: string): ComponentEntry | undefined {
  return entries.find(
    (e) => e.name.toLowerCase() === name.toLowerCase(),
  )
}

/** Categorised list for the sidebar */
export interface CategoryGroup {
  category: string
  items: ComponentEntry[]
}

export function groupedEntries(): CategoryGroup[] {
  const map = new Map<string, ComponentEntry[]>()
  for (const e of entries) {
    if (!map.has(e.category)) map.set(e.category, [])
    map.get(e.category)!.push(e)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => ({ category, items }))
}
