import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import AstalHyprland from "gi://AstalHyprland?version=0.1"
import GLib from "gi://GLib?version=2.0"
import { onCleanup } from "gnim"
import { useSettings } from "#/lib/settings"
import { toArray } from "#/lib/gjsUtils"
import { getAppList, exactQuery } from "#/lib/apps"
import { ActionButton } from "#/widget/common/actionButton"

interface DockItemProps {
  desktopFile: string
  clients: AstalHyprland.Client[]
  active: boolean
  pinned: boolean
}

export default ({ desktopFile, clients, active, pinned }: DockItemProps) => {
  const { bar } = useSettings()

  const app =
    toArray(getAppList()).find((a) => a.entry === desktopFile) ||
    exactQuery(desktopFile.replace(".desktop", ""))?.[0]

  const iconName = app?.iconName || "application-x-executable-symbolic"
  const running = clients.length > 0

  const handleLeftClick = () => {
    if (running) {
      clients[0].focus()
    } else if (pinned) {
      GLib.spawn_command_line_async(`gtk-launch ${desktopFile}`)
    }
  }

  const handleClose = () => {
    for (const client of clients) {
      client.kill()
    }
  }

  const handlePinToggle = () => {
    const current = bar.dockPinnedApps() as string[]
    if (pinned) {
      bar.dockPinnedApps.set(current.filter((d) => d !== desktopFile))
    } else {
      bar.dockPinnedApps.set([...current, desktopFile])
    }
  }

  const popover = (
    <Gtk.Popover cssClasses={["menu"]} hasArrow={false}>
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={4}
        css={"padding: 8px;"}
      >
        <ActionButton
          iconName="focus-windows-symbolic"
          label="Focus"
          visible={running}
          onClicked={() => {
            handleLeftClick()
            popover.popdown()
          }}
        />
        <ActionButton
          iconName="window-close-symbolic"
          label="Close"
          visible={running}
          onClicked={() => {
            handleClose()
            popover.popdown()
          }}
        />
        <ActionButton
          iconName={pinned ? "edit-delete-symbolic" : "list-add-symbolic"}
          label={pinned ? "Unpin" : "Pin"}
          onClicked={() => {
            handlePinToggle()
            popover.popdown()
          }}
        />
      </Gtk.Box>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <Gtk.Button
      $={(self) => {
        popover.set_parent(self)
        onCleanup(() => {
          popover.popdown()
          popover.unparent()
        })
        // Create child content once to avoid gtk_button_set_child assertion
        // when Gnim re-renders this component (e.g. on focus change).
        if (!self.get_first_child()) {
          const icon = <Gtk.Image iconName={iconName} />
          // Bind icon size reactively
          bar.dockIconSize.subscribe((size) => icon.set_pixel_size(size))
          icon.set_pixel_size(bar.dockIconSize.get())

          const status = <Gtk.Box />
          // Update status indicator reactively
          const updateStatus = () => {
            status.css = active
              ? `
                min-width: 16px;
                min-height: 3px;
                border-radius: 2px;
                background-color: @accent_color;
              `
              : running
                ? `
                  min-width: 4px;
                  min-height: 4px;
                  border-radius: 2px;
                  background-color: @accent_color;
                `
                : ""
            status.visible = active || running
          }
          updateStatus()
          // Re-evaluate status on active/running changes isn't reactive via props —
          // the component re-creates on those changes, so this runs once per mount.

          const box = (
            <Gtk.Box
              orientation={Gtk.Orientation.VERTICAL}
              spacing={4}
              halign={Gtk.Align.CENTER}
              valign={Gtk.Align.CENTER}
            >
              {icon}
              {status}
            </Gtk.Box>
          )
          self.child = box
        }
      }}
      cssClasses={["flat", "circular"]}
      cursor={Gdk.Cursor.new_from_name("pointer", null)}
      onClicked={handleLeftClick}
      tooltipText={app?.name || desktopFile.replace(".desktop", "")}
    >
      <Gtk.GestureClick
        $={(self) => {
          self.set_button(Gdk.BUTTON_SECONDARY)
          self.connect("pressed", () => popover.popup())
        }}
      />

    </Gtk.Button>
  )
}
