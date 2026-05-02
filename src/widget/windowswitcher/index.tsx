import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import AstalHyprland from "gi://AstalHyprland?version=0.1"
import { createBinding, createState, For, onCleanup } from "gnim"
import { app } from "#/App"
import { toArray } from "#/lib/gjsUtils"
import SwitcherItem from "./item"

const hyprland = AstalHyprland.get_default()

let switcherWindow: Astal.Window | null = null

export const toggleWindowSwitcher = () => {
  if (switcherWindow) {
    switcherWindow.visible = !switcherWindow.visible
  }
}

const getSortedClients = (clients: any, mru: string[]): AstalHyprland.Client[] => {
  const arr = toArray<AstalHyprland.Client>(clients)
  const sorted = mru
    .map(addr => arr.find(c => c.address === addr))
    .filter((c): c is AstalHyprland.Client => c !== undefined)
  const newClients = arr.filter(c => !mru.includes(c.address))
  return [...sorted, ...newClients]
}

export default () => {
  const [selectedIndex, setSelectedIndex] = createState(0)

  let mru: string[] = []

  const updateMru = (client: AstalHyprland.Client | null) => {
    if (!client || client.address === "0x0") return
    mru = mru.filter(addr => addr !== client.address)
    mru.unshift(client.address)
  }

  const mruUnsubscribe = createBinding(hyprland, "focusedClient")
    .subscribe(client => updateMru(client as AstalHyprland.Client | null))

  const clientsBinding = createBinding(hyprland, "clients")
  const clientsList = clientsBinding.as(c => getSortedClients(c, mru))

  const clampUnsubscribe = clientsList.subscribe(list => {
    const len = list?.length ?? 0
    if (selectedIndex.get() >= len) {
      setSelectedIndex(Math.max(0, len - 1))
    }
  })

  let superPressed = false
  let superReleased = false

  const closeSwitcher = () => {
    if (switcherWindow) {
      switcherWindow.visible = false
    }
    superPressed = false
    superReleased = false
  }

  const doFocus = (client: AstalHyprland.Client) => {
    client.focus()
    closeSwitcher()
  }

  const handleKeyPressed = (_: Gtk.EventControllerKey, keyval: number): boolean => {
    const clients = clientsList.get() ?? []

    switch (keyval) {
      case Gdk.KEY_Tab:
      case Gdk.KEY_Right:
        if (clients.length > 0) {
          setSelectedIndex(i => (i + 1) % clients.length)
        }
        return true
      case Gdk.KEY_ISO_Left_Tab:
      case Gdk.KEY_Left:
        if (clients.length > 0) {
          setSelectedIndex(i => (i - 1 + clients.length) % clients.length)
        }
        return true
      case Gdk.KEY_Return:
      case Gdk.KEY_KP_Enter:
        if (clients[selectedIndex.get()]) {
          doFocus(clients[selectedIndex.get()])
        }
        return true
      case Gdk.KEY_Escape:
        closeSwitcher()
        return true
      case Gdk.KEY_q:
      case Gdk.KEY_Q:
        if (clients[selectedIndex.get()]) {
          clients[selectedIndex.get()].kill()
        }
        return true
      case Gdk.KEY_Super_L:
      case Gdk.KEY_Super_R:
      case Gdk.KEY_Meta_L:
      case Gdk.KEY_Meta_R:
        superPressed = true
        return false
    }
    return false
  }

  const handleKeyReleased = (_: Gtk.EventControllerKey, keyval: number): boolean => {
    if ((keyval === Gdk.KEY_Super_L || keyval === Gdk.KEY_Super_R ||
         keyval === Gdk.KEY_Meta_L || keyval === Gdk.KEY_Meta_R) && !superReleased) {
      superReleased = true
      const clients = clientsList.get() ?? []
      if (clients[selectedIndex.get()]) {
        doFocus(clients[selectedIndex.get()])
      } else {
        closeSwitcher()
      }
      return true
    }
    return false
  }

  let boxRef: Gtk.Box | null = null

  const onOpen = () => {
    const clients = clientsList.get() ?? []
    setSelectedIndex(clients.length > 1 ? 1 : 0)
    superPressed = false
    superReleased = false
    boxRef?.grab_focus()
  }

  return <Astal.Window
    $={self => {
      switcherWindow = self
      onCleanup(() => {
        switcherWindow = null
        mruUnsubscribe()
        clampUnsubscribe()
      })
    }}
    name={"windowswitcher"}
    application={app}
    layer={Astal.Layer.OVERLAY}
    keymode={Astal.Keymode.EXCLUSIVE}
    visible={false}
    onNotifyVisible={self => {
      if (self.visible) onOpen()
    }}
    anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.BOTTOM |
      Astal.WindowAnchor.LEFT | Astal.WindowAnchor.RIGHT}
    monitor={createBinding(hyprland, "focusedMonitor").as(m => m.id)}
    css={"background-color: transparent;"}
  >
    <Gtk.Box
      $={self => { boxRef = self }}
      focusable
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.CENTER}
      orientation={Gtk.Orientation.VERTICAL}
      spacing={8}
      widthRequest={500}>
      <Gtk.EventControllerKey
        $={self => {
          self.connect("key-pressed", handleKeyPressed)
          self.connect("key-released", handleKeyReleased)
        }}
      />
      <For each={clientsList}>
        {(client: AstalHyprland.Client) =>
          <SwitcherItem
            client={client}
            selected={selectedIndex.as(idx => {
            const clients = clientsList.get() ?? []
            return clients[idx]?.address === client.address
          })}
          />
        }
      </For>
      <Gtk.Label
        visible={clientsList.as(l => l.length === 0)}
        cssClasses={["title-3"]}
        marginTop={24}
        marginBottom={24}
        label="No open windows"
      />
    </Gtk.Box>
  </Astal.Window>
}
