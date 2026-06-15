import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import AstalHyprland from "gi://AstalHyprland?version=0.1"
import GLib from "gi://GLib?version=2.0"
import { onCleanup } from "gnim"
import { useSettings } from "#/lib/settings"
import { toArray } from "#/lib/gjsUtils"
import { getAppList, exactQuery } from "#/lib/apps"

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
        <Gtk.Button
          cssClasses={["flat"]}
          visible={running}
          onClicked={() => {
            handleLeftClick()
            popover.popdown()
          }}
        >
          <Gtk.Box spacing={8}>
            <Gtk.Image iconName="focus-windows-symbolic" />
            <Gtk.Label label="Focus" />
          </Gtk.Box>
        </Gtk.Button>
        <Gtk.Button
          cssClasses={["flat"]}
          visible={running}
          onClicked={() => {
            handleClose()
            popover.popdown()
          }}
        >
          <Gtk.Box spacing={8}>
            <Gtk.Image iconName="window-close-symbolic" />
            <Gtk.Label label="Close" />
          </Gtk.Box>
        </Gtk.Button>
        <Gtk.Button
          cssClasses={["flat"]}
          onClicked={() => {
            handlePinToggle()
            popover.popdown()
          }}
        >
          <Gtk.Box spacing={8}>
            <Gtk.Image
              iconName={pinned ? "edit-delete-symbolic" : "list-add-symbolic"}
            />
            <Gtk.Label label={pinned ? "Unpin" : "Pin"} />
          </Gtk.Box>
        </Gtk.Button>
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
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={4}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
      >
        <Gtk.Image iconName={iconName} pixelSize={bar.dockIconSize()} />
        {active ? (
          <Gtk.Box
            css={`
              min-width: 16px;
              min-height: 3px;
              border-radius: 2px;
              background-color: @accent_color;
            `}
          />
        ) : running ? (
          <Gtk.Box
            css={`
              min-width: 4px;
              min-height: 4px;
              border-radius: 2px;
              background-color: @accent_color;
            `}
          />
        ) : null}
      </Gtk.Box>
    </Gtk.Button>
  )
}
