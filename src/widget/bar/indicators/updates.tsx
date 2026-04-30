import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import UpdatesService from "#/lib/updates"
import { useSettings } from "#/lib/settings"

export default () => {
  const settings = useSettings()
  const updates = UpdatesService.get_default()

  return (
    <Gtk.Box
      visible={settings.bar.get_boolean("show-updates")}
      tooltipText={createBinding(updates, "count").as(c =>
        c === 0 ? "System is up to date" : `${c} update${c === 1 ? "" : "s"} available`
      )}
      onButtonPressed={() => { updates.check() }}
      cssClasses={["linked"]}>
      <Gtk.Image
        iconName="software-update-available-symbolic"
        pixelSize={18} />
      <Gtk.Label
        visible={createBinding(updates, "count").as(c => c > 0)}
        label={createBinding(updates, "count").as(c => `${c}`)}
        cssClasses={["caption"]} />
    </Gtk.Box>
  )
}
