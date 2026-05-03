import AstalBluetooth from "gi://AstalBluetooth"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed, createState, For } from "gnim"
import logger from "#/lib/logger"

export default () => {
  logger.log("Bluetooth: get_default()")
  const bluetooth = AstalBluetooth.get_default()
  logger.log("Bluetooth: done")
  const [connectingAddress, setConnectingAddress] = createState<string | null>(null)

  const isConnecting = connectingAddress.as(addr => addr !== null)

  return <Adw.SplitButton
    visible={createBinding(bluetooth, "adapters")
      .as(a => a.length > 0)}
    cssClasses={["raised"]}
    hexpand
    $={self => {
      self.connect("clicked", () => {
        bluetooth.adapter.powered = !bluetooth.adapter.powered
      })
      self.connect("activate", () => {
        bluetooth.adapter.discoverable = true
      })
      self.connect("destroy", () => {
        const popover = self.popover
        if (popover?.parent) popover.unparent()
      })
    }}
    popover={
      <Gtk.Popover cssClasses={[]}>
        <Gtk.Box cssClasses={["linked"]}
          orientation={Gtk.Orientation.VERTICAL}
          marginStart={8}
          marginEnd={8}
          marginTop={8}
          marginBottom={8}
          spacing={4}>
          <For each={createBinding(bluetooth, "devices")}>
            {(device: AstalBluetooth.Device) => {
              const deviceConnecting = connectingAddress.as(addr =>
                addr !== null && addr === device.address)

              return <Gtk.Button onClicked={() => {
                if (device.connected) {
                  device.disconnect_device((_, res) => {
                    try {
                      device.disconnect_device_finish(res)
                    } catch (e) {
                      print(e)
                    }
                  })
                } else {
                  setConnectingAddress(device.address)
                  device.connect_device((_, res) => {
                    setConnectingAddress(null)
                    try {
                      device.connect_device_finish(res)
                    } catch (e) {
                      print(e)
                    }
                  })
                }
              }}>
                <Gtk.Box spacing={8}>
                  <Gtk.Image
                    iconName={device.icon}
                    pixelSize={16}
                  />
                  <Gtk.Label
                    hexpand
                    halign={Gtk.Align.START}
                    label={device.name}
                  />
                  {deviceConnecting.as(connecting => connecting
                    ? <Gtk.Spinner
                        spinning
                        marginEnd={4}
                      />
                    : <Gtk.Image
                        visible={createBinding(device, "connected")}
                        iconName="emblem-ok-symbolic"
                        pixelSize={16}
                      />)}
                </Gtk.Box>
              </Gtk.Button>
            }}
          </For>
        </Gtk.Box>
      </ Gtk.Popover> as Gtk.Popover}>
    <Adw.ButtonContent
      iconName={createComputed([
        isConnecting,
        createBinding(bluetooth, "isPowered")
      ], (connecting, powered) =>
        connecting
          ? "content-loading-symbolic"
          : powered
            ? "bluetooth-symbolic"
            : "bluetooth-disabled-symbolic"
      )}
      label={createBinding(bluetooth, "isPowered")
        .as(isPowered => isPowered ? "Bluetooth" : "Bluetooth Off")} />
  </Adw.SplitButton>
}
