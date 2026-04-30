import Gtk from "gi://Gtk?version=4.0"
import { ClipboardItem, copyClipboardItem, deleteClipboardItem, formatClipboardPreview } from "#/lib/clipboard"
import WindowManager from "#/lib/windowManager"

export default ({ item }: { item: ClipboardItem }) => {
  const preview = formatClipboardPreview(item.text)

  return <Gtk.Button
    cssClasses={["app-button"]}
    onClicked={() => {
      copyClipboardItem(item.id)
      WindowManager.get_default().applauncher!.visible = false
    }}>
    <Gtk.Box
      spacing={12}
      valign={Gtk.Align.CENTER}>
      <Gtk.Image
        iconName={item.text.startsWith("[") ? "image-x-generic-symbolic" : "edit-paste-symbolic"}
        pixelSize={32} />
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        valign={Gtk.Align.CENTER}>
        <Gtk.Label
          cssClasses={["title-2"]}
          halign={Gtk.Align.START}
          label={preview} />
        <Gtk.Label
          halign={Gtk.Align.START}
          label={`ID: ${item.id}`}
          cssClasses={["caption"]} />
      </Gtk.Box>
    </Gtk.Box>
  </Gtk.Button>
}
