import Astal from "gi://Astal?version=4.0"
import Gio from "gi://Gio?version=2.0"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import { createBinding, createComputed, For, onCleanup } from "gnim"
import { ColorScheme, DarkModes } from "#/lib/colorScheme"
import { useSettings } from "#/lib/settings"
import WindowManager from "#/lib/windowManager"
import { monitors } from "#/lib/monitors"

export const Wallpaper = () => {
  const settings = useSettings().general
  const wp = createComputed(
    [
      createBinding(ColorScheme.get_default(), "colorScheme"),
      createBinding(ColorScheme.get_default(), "daytime"),
      settings.wallpaperDay,
      settings.wallpaperNight,
    ],
    (color, daytime, wpDay, wpNight) => {
      if (color === DarkModes.AUTO)
        return Gio.File.new_for_path(daytime ? wpDay : wpNight)
      if (color === DarkModes.LIGHT) return Gio.File.new_for_path(wpDay)
      else return Gio.File.new_for_path(wpNight)
    },
  )

  return (
    <For each={monitors}>
      {(monitor: Gdk.Monitor) => (
        <Astal.Window
          $={(self) => {
            WindowManager.get_default().registerWallpaper(self)
            onCleanup(() => {
              WindowManager.get_default().unregisterWallpaper(self)
              self.destroy()
            })
          }}
          gdkmonitor={monitor}
          layer={Astal.Layer.BACKGROUND}
          anchor={
            Astal.WindowAnchor.TOP |
            Astal.WindowAnchor.RIGHT |
            Astal.WindowAnchor.BOTTOM |
            Astal.WindowAnchor.LEFT
          }
          exclusivity={Astal.Exclusivity.IGNORE}
          visible
        >
          <Gtk.Picture contentFit={Gtk.ContentFit.COVER} file={wp} />
        </Astal.Window>
      )}
    </For>
  )
}
