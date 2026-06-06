import Notifd from "gi://AstalNotifd"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib"
import { For, createBinding } from "gnim"

export default ({
  notif,
  closeAction,
  pauseDismiss,
  resumeDismiss,
  showProgress = true,
}: {
  notif: Notifd.Notification
  closeAction: (notif: Notifd.Notification, self: Gtk.Widget) => void
  pauseDismiss?: () => void
  resumeDismiss?: () => void
  showProgress?: boolean
}) =>
  (
    <Gtk.Box
      name={notif.id.toString()}
      cssClasses={["card", "frame"]}
      css={"box-shadow:none;"}
      spacing={8}
      orientation={Gtk.Orientation.VERTICAL}
      $={(self) => {
        if (pauseDismiss && resumeDismiss) {
          const controller = Gtk.EventControllerMotion.new()
          controller.connect("enter", pauseDismiss)
          controller.connect("leave", resumeDismiss)
          self.add_controller(controller)
        }
      }}
    >
      <Gtk.Box spacing={8}>
        <Gtk.Image
          pixelSize={24}
          visible={!!notif.app_icon}
          iconName={notif.app_icon}
        />
        <Gtk.Label
          wrap
          hexpand
          cssClasses={["title-4"]}
          label={notif.summary || ""}
        />
        <Gtk.Button
          halign={Gtk.Align.END}
          valign={Gtk.Align.CENTER}
          cssClasses={["circular"]}
          onClicked={(self) => closeAction(notif, self.parent.parent)}
          iconName={"window-close-symbolic"}
        />
      </Gtk.Box>
      <Gtk.Label
        wrap
        maxWidthChars={25}
        cssClasses={["body"]}
        useMarkup={notif.body.startsWith("<")}
        label={notif.body || ""}
      />
      <Gtk.Label
        label={
          GLib.DateTime.new_from_unix_local(notif.time).format("%H:%M:%S") ||
          "ERROR"
        }
      />
      <Gtk.ProgressBar
        visible={showProgress}
        fraction={0}
        cssClasses={["osd"]}
        $={(self) => {
          if (!showProgress) return
          let elapsed = 0
          const interval = 50
          const total = 5000
          const timer = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
              if (!self.get_parent()) return GLib.SOURCE_REMOVE
              elapsed += interval
              const remaining = Math.max(0, total - elapsed)
              self.set_fraction(remaining / total)
              if (remaining <= 0) return GLib.SOURCE_REMOVE
              return GLib.SOURCE_CONTINUE
            },
          )
          self.connect("destroy", () => {
            GLib.source_remove(timer)
          })
        }}
      />
      <Gtk.Box cssClasses={["actions"]} spacing={4}>
        <For
          each={createBinding(notif, "actions").as((actions) =>
            actions.filter((a) => a.label && a.label.trim() !== ""),
          )}
        >
          {(action: Notifd.Action) => (
            <Gtk.Button
              onClicked={() => notif.invoke(action.id)}
              label={action.label}
            />
          )}
        </For>
      </Gtk.Box>
    </Gtk.Box>
  ) as Gtk.Widget
