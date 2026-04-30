import Adw from "gi://Adw?version=1";
import Notifd from "gi://AstalNotifd";
import Gtk from "gi://Gtk?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import { createBinding, createState, For } from "gnim";
import Notification from "../common/notification";
import NotificationHistory from "#/lib/notificationHistory";

export const NotificationList = () => {
  const notifd = Notifd.get_default();
  const history = NotificationHistory.get_default();
  const [showHistory, setShowHistory] = createState(false);

  const Header = () => {
    const DNDButton = () => <Gtk.ToggleButton
      onClicked={self => notifd.dontDisturb = self.active}
      active={createBinding(notifd, "dontDisturb")}
      cursor={Gdk.Cursor.new_from_name("pointer", null)}
      iconName={"notifications-disabled-symbolic"}
      cssClasses={createBinding(notifd, "dontDisturb")
        .as(d => d ? ["suggested-action", "warning"] : ["flat"])}
    />

    const ClearAllButton = () => <Gtk.Button
      halign={Gtk.Align.END}
      cursor={Gdk.Cursor.new_from_name("pointer", null)}
      onClicked={() => notifd.get_notifications().
        forEach(n => n.dismiss())}>
      <Adw.ButtonContent
        iconName={"edit-clear-all-symbolic"}
        label={"Clear"} />
    </Gtk.Button >

    return <Gtk.Box
      cssClasses={["toolbar"]}>
      <Gtk.Label
        label={showHistory.as(h => h ? "History" : "Notifications")}
        cssClasses={["title-1"]}
        hexpand
      />
      <Gtk.Button
        cssClasses={["flat"]}
        iconName={showHistory.as(h => h ? "go-previous-symbolic" : "document-open-recent-symbolic")}
        onClicked={() => setShowHistory(!showHistory.get())}
        tooltipText={showHistory.as(h => h ? "Back to notifications" : "View history")}
      />
      <ClearAllButton />
      <DNDButton />
    </Gtk.Box>
  }

  const NotificationGroup = ({ notifications }:
    { notifications: Notifd.Notification[] }) => {
    const [visible, setVisible] = createState(false)

    const Heading = () => <Gtk.Box
      cssClasses={["toolbar"]}>
      <Gtk.ToggleButton
        onClicked={() =>
          setVisible(!visible.get())}
        active={visible}
        cssClasses={["flat"]}>
        <Gtk.Box>
          <Gtk.Image
            iconName={notifications[0].appIcon} />
          <Gtk.Label
            label={notifications[0].appName}
            hexpand />
          <Gtk.Image
            iconName={visible.as(v =>
              v ? "go-up-symbolic" : "go-down-symbolic")} />
        </Gtk.Box>
      </Gtk.ToggleButton>
      <Gtk.Button
        iconName={"edit-clear-all-symbolic"}
        valign={Gtk.Align.END}
        onClicked={() =>
          notifications.forEach(n => n.dismiss())}
      />
    </Gtk.Box>

    return <Gtk.Box
      spacing={4}
      orientation={Gtk.Orientation.VERTICAL}>
      <Heading />
      <Notification
        notif={notifications[0]}
        closeAction={n => n.dismiss()}
      />
      <Gtk.Revealer revealChild={visible}>
        <Gtk.Box
          spacing={4}
          orientation={Gtk.Orientation.VERTICAL}>
          {notifications.slice(1).map(notif =>
            <Notification
              notif={notif}
              closeAction={n => n.dismiss()} />
          )}
        </Gtk.Box>
      </Gtk.Revealer>
    </Gtk.Box>
  }

  const HistoryItem = ({ entry }: { entry: { id: number, appName: string, appIcon: string, summary: string, body: string, time: number } }) => (
    <Gtk.Box
      cssClasses={["card"]}
      spacing={8}
      marginBottom={4}>
      <Gtk.Image pixelSize={24} iconName={entry.appIcon || "dialog-information-symbolic"} />
      <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand>
        <Gtk.Label
          halign={Gtk.Align.START}
          cssClasses={["title-4"]}
          label={entry.summary} />
        <Gtk.Label
          halign={Gtk.Align.START}
          cssClasses={["caption"]}
          label={`${entry.appName} — ${GLib.DateTime.new_from_unix_local(entry.time).format("%H:%M") || ""}`} />
      </Gtk.Box>
      <Gtk.Button
        cssClasses={["flat", "circular"]}
        iconName={"edit-delete-symbolic"}
        onClicked={() => history.remove(entry.id)} />
    </Gtk.Box>
  )

  return <Gtk.Box
    orientation={Gtk.Orientation.VERTICAL}
    cssClasses={["notif-list"]}
    spacing={4}>
    <Header />
    <Gtk.Box
      visible={showHistory}
      orientation={Gtk.Orientation.VERTICAL}
      spacing={6}>
      <Gtk.Box spacing={8} cssClasses={["toolbar"]}>
        <Gtk.Label hexpand label="Recent Notifications" cssClasses={["caption-heading"]} />
        <Gtk.Button
          cssClasses={["flat"]}
          label="Clear History"
          onClicked={() => history.clear()} />
      </Gtk.Box>
      <For each={createBinding(history, "history").as(h => h.slice(0, 20))}>
        {(entry: any) => <HistoryItem entry={entry} />}
      </For>
      <Adw.StatusPage
        visible={createBinding(history, "history").as(h => h.length === 0)}
        vexpand
        cssClasses={["compact"]}
        title="No History"
        description="Notification history is empty"
        iconName="user-offline-symbolic" />
    </Gtk.Box>
    <Gtk.Box
      visible={showHistory.as(v => !v)}
      orientation={Gtk.Orientation.VERTICAL}
      spacing={6}>
      <For each={createBinding(notifd, "notifications").as(n => n
        .sort((a, b) => b.time - a.time)
        .reduce((res, notif) => {
          const i = res.findIndex(n =>
            n[0].appName === notif.appName)
          if (i === -1)
            res.push([notif]);
          else
            res[i].push(notif);
          return res;
        }, [] as Notifd.Notification[][]))}>
        {(n: Notifd.Notification[]) =>
          n.length === 1 ?
            <Notification
              closeAction={n => n.dismiss()}
              notif={n[0]} />
            :
            <NotificationGroup notifications={n} />
        }
      </For>
      <Adw.StatusPage
        visible={createBinding(notifd, "notifications")
          .as(n => n.length < 1)}
        vexpand
        cssClasses={["compact"]}
        title={"No new Notifications"}
        description={"You're up-to-date"}
        iconName={"user-offline-symbolic"} />
    </Gtk.Box>
  </Gtk.Box >
}
