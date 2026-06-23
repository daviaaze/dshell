import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import Adw from "gi://Adw?version=1"
import AstalHyprland from "gi://AstalHyprland?version=0.1"
import GLib from "gi://GLib?version=2.0"
import { createBinding, createState } from "gnim"
import { app } from "#/App"
import WindowManager from "#/lib/windowManager"
import Screenshot from "#/lib/screenshot"
import { getScreenCaptureSettings } from "#/lib/screenCaptureSettings"
import { LinkedBox } from "#/widget/common/linkedBox"
import logger from "#/lib/logger"

export default () => {
  const ss = Screenshot.get_default()
  const hyprland = AstalHyprland.get_default()
  const captureSettings = getScreenCaptureSettings()

  // Snapshot focused client/monitor geometry before overlay steals focus
  const [savedClientGeometry, setSavedClientGeometry] = createState<string | null>(null)
  const [savedMonitorGeometry, setSavedMonitorGeometry] = createState<string | null>(null)

  // ── Handlers ──────────────────────────────────────────────────────

  const close = () => {
    ss.overlayOpen = false
  }

  const handleKeyPressed = (_ctrl: Gtk.EventControllerKey, keyval: number) => {
    if (keyval === Gdk.KEY_Escape) {
      close()
      return true
    }
    if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
      executeCapture()
      return true
    }
    return false
  }

  const executeCapture = () => {
    const mode = ss.selectedMode
    const target = ss.selectedTarget

    logger.info("screenshot-overlay", `capture: mode=${mode}, target=${target}`)

    // For area selection, close toolbar and open region-selector
    if (target === "area") {
      close()
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
        ss.regionSelectorOpen = true
        return GLib.SOURCE_REMOVE
      })
      return
    }

    close()

    // Small delay to let the overlay close before capture
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
      if (mode === "screenshot") {
        switch (target) {
          case "fullscreen":
            ss.screenshot(true)
            break
          case "window": {
            const geometry = savedClientGeometry()
            if (geometry) ss.screenshotGeometry(geometry)
            break
          }
          case "monitor": {
            const geometry = savedMonitorGeometry()
            if (geometry) ss.screenshotGeometry(geometry)
            break
          }
        }
      } else {
        // Recording mode
        switch (target) {
          case "fullscreen":
            ss.toggleRecording()
            break
          case "window": {
            const geometry = savedClientGeometry()
            if (geometry) ss.startRecording({ geometry })
            break
          }
          case "monitor":
            ss.recordOutput()
            break
        }
      }
      return GLib.SOURCE_REMOVE
    })
  }

  // ── Mode tab button factory ───────────────────────────────────────

  const ModeTab = ({
    label,
    value,
    icon,
  }: {
    label: string
    value: "screenshot" | "recording"
    icon: string
  }) => (
    <Gtk.ToggleButton
      active={createBinding(ss, "selected-mode").as((m) => m === value)}
      onToggled={(btn) => {
        if (btn.active) ss.selectedMode = value
      }}
      hexpand
    >
      <Adw.ButtonContent iconName={icon} label={label} />
    </Gtk.ToggleButton>
  )

  // ── Target button factory ─────────────────────────────────────────

  const TargetButton = ({
    label,
    value,
    icon,
  }: {
    label: string
    value: "fullscreen" | "area" | "window" | "monitor"
    icon: string
  }) => (
    <Gtk.ToggleButton
      active={createBinding(ss, "selected-target").as((t) => t === value)}
      onToggled={(btn) => {
        if (btn.active) ss.selectedTarget = value
      }}
      hexpand
    >
      <Adw.ButtonContent iconName={icon} label={label} />
    </Gtk.ToggleButton>
  )

  return (
    <Astal.Window
      $={(self) => {
        WindowManager.get_default().setOverlay(self)
        self.connect("realize", () => {
          logger.log("screenshot-overlay realized")
        })
        self.connect("map", () => {
          logger.log("screenshot-overlay mapped")
          // Focus the window for keyboard capture
        })
      }}
      name={"screenshot-overlay"}
      application={app}
      layer={Astal.Layer.TOP}
      keymode={Astal.Keymode.EXCLUSIVE}
      visible={createBinding(ss, "overlay-open")}
      onNotifyVisible={(self) => {
        if (self.visible) {
          // Snapshot geometry before our window steals Hyprland focus
          const client = hyprland.focused_client
          if (client) {
            setSavedClientGeometry(`${client.x},${client.y} ${client.width}x${client.height}`)
          }
          const mon = hyprland.focused_monitor
          if (mon) {
            setSavedMonitorGeometry(`${mon.x},${mon.y} ${mon.width}x${mon.height}`)
          }
        }
        if (!self.visible) ss.overlayOpen = false
      }}
      anchor={
        Astal.WindowAnchor.TOP |
        Astal.WindowAnchor.BOTTOM |
        Astal.WindowAnchor.LEFT |
        Astal.WindowAnchor.RIGHT
      }
      monitor={createBinding(hyprland, "focusedMonitor").as((m) => m.id)}
      css={"background-color: transparent;"}
    >
      <Gtk.Box
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
        hexpand
        vexpand
        orientation={Gtk.Orientation.VERTICAL}
      >
        <Gtk.EventControllerKey
          $={(self) => {
            self.connect("key-pressed", handleKeyPressed)
          }}
        />

        {/* Main toolbar card */}
        <Gtk.Box
          cssClasses={["card", "frame", "background"]}
          orientation={Gtk.Orientation.VERTICAL}
          spacing={12}
          widthRequest={480}
          css={"padding: 16px;"}
        >
          {/* ── Mode Toggle ─────────────────────────────────── */}
          <Gtk.Box spacing={4} homogeneous cssClasses={["linked"]}>
            <ModeTab
              label="Screenshot"
              value="screenshot"
              icon="camera-photo-symbolic"
            />
            <ModeTab
              label="Recording"
              value="recording"
              icon="camera-video-symbolic"
            />
          </Gtk.Box>

          <Gtk.Separator />

          {/* ── Target Picker ───────────────────────────────── */}
          <Gtk.Label
            label="Capture Area"
            halign={Gtk.Align.START}
            cssClasses={["caption", "heading"]}
          />
          <LinkedBox>
            <TargetButton
              label="Fullscreen"
              value="fullscreen"
              icon="video-display-symbolic"
            />
            <TargetButton
              label="Area"
              value="area"
              icon="selection-mode-symbolic"
            />
            <TargetButton
              label="Window"
              value="window"
              icon="focus-windows-symbolic"
            />
            <TargetButton
              label="Monitor"
              value="monitor"
              icon="video-display-symbolic"
            />
          </LinkedBox>

          <Gtk.Separator />

          {/* ── Options ─────────────────────────────────────── */}
          <Gtk.Box spacing={12}>
            {/* Audio toggle */}
            <Gtk.CheckButton
              active={createBinding(ss, "audio")}
              onNotifyActive={({ active }) => {
                ss.audio = active
              }}
            >
              <Gtk.Label label="Audio" />
            </Gtk.CheckButton>

            {/* Boundary toggle */}
            <Gtk.CheckButton
              active={createBinding(
                captureSettings.settings,
                "show-recording-boundary",
              )}
              onNotifyActive={({ active }) => {
                captureSettings.setShowRecordingBoundary(active)
              }}
            >
              <Gtk.Label label="Boundary" />
            </Gtk.CheckButton>
          </Gtk.Box>

          <Gtk.Separator />

          {/* ── Capture Button ──────────────────────────────── */}
          <Gtk.Button
            onClicked={executeCapture}
            cssClasses={["suggested-action"]}
            hexpand
          >
            <Adw.ButtonContent
              iconName={createBinding(ss, "selected-mode").as((m) =>
                m === "screenshot"
                  ? "camera-photo-symbolic"
                  : "camera-video-symbolic",
              )}
              label={createBinding(ss, "selected-mode").as((m) =>
                m === "screenshot" ? "Take Screenshot" : "Start Recording",
              )}
            />
          </Gtk.Button>

          {/* Keyboard shortcut hint */}
          <Gtk.Label
            label="Press Esc to cancel  ·  Enter to capture"
            halign={Gtk.Align.CENTER}
            cssClasses={["caption"]}
            css={"opacity: 0.6;"}
          />
        </Gtk.Box>
      </Gtk.Box>
    </Astal.Window>
  )
}
