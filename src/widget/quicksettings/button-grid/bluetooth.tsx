import AstalBluetooth from "gi://AstalBluetooth"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createBinding, createComputed, createState, For, onMount } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import logger from "#/lib/logger"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"
import { toArray } from "#/lib/gjsUtils"

export default () => {
  logger.log("Bluetooth: get_default()")
  // ButtonGrid items only render when quicksettings opens — D-Bus
  // services are already available by then, so synchronous call is safe.
  const bluetooth = AstalBluetooth.get_default()
  logger.log("Bluetooth: done")
  const [connectingAddress, setConnectingAddress] = createState<string | null>(
    null,
  )

  const isConnecting = connectingAddress.as((addr) => addr !== null)

  const popover = (
    <Gtk.Popover cssClasses={[]}>
      <LinkedPopoverBox>
        <For
          each={createBinding(bluetooth, "devices").as((d) =>
            toArray<AstalBluetooth.Device>(d),
          )}
        >
          {(device: AstalBluetooth.Device) => {
            const deviceConnecting = connectingAddress.as(
              (addr) => addr !== null && addr === device.address,
            )

            return (
              <Gtk.Button
                onClicked={() => {
                  if (device.connected) {
                    device.disconnect_device((_, res) => {
                      try {
                        device.disconnect_device_finish(res)
                      } catch (e) {
                        logger.error("bluetooth", "disconnect failed:", e)
                      }
                    })
                  } else {
                    setConnectingAddress(device.address)
                    device.connect_device((_, res) => {
                      setConnectingAddress(null)
                      try {
                        device.connect_device_finish(res)
                      } catch (e) {
                        logger.error("bluetooth", "connect failed:", e)
                      }
                    })
                  }
                }}
              >
                <Gtk.Box spacing={8}>
                  <Gtk.Image
                    iconName={device.icon || "bluetooth-symbolic"}
                    pixelSize={16}
                  />
                  <Gtk.Label
                    hexpand
                    halign={Gtk.Align.START}
                    label={device.name}
                  />
                  <Gtk.Spinner
                    visible={deviceConnecting}
                    spinning
                    marginEnd={4}
                  />
                  <Gtk.Image
                    visible={createBinding(device, "connected")}
                    iconName="selection-mode-symbolic"
                    pixelSize={16}
                  />
                </Gtk.Box>
              </Gtk.Button>
            )
          }}
        </For>
      </LinkedPopoverBox>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      visible={createBinding(bluetooth, "adapters").as((a) => a.length > 0)}
      icon={createComputed(
        [isConnecting, createBinding(bluetooth, "isPowered")],
        (connecting, powered) =>
          connecting
            ? "content-loading-symbolic"
            : powered
              ? "bluetooth-symbolic"
              : "bluetooth-disabled-symbolic",
      )}
      cssClasses={createComputed(
        [
          createBinding(bluetooth, "isPowered"),
          createBinding(bluetooth, "is-connected"),
        ],
        (powered, connected) =>
          powered && connected ? ["raised", "suggested-action"] : ["raised"],
      )}
      label={createComputed(
        [
          createBinding(bluetooth, "isPowered"),
          createBinding(bluetooth, "is-connected"),
        ],
        (powered, _connected) => {
          if (!powered) return "Bluetooth Off"
          const connected = toArray<AstalBluetooth.Device>(
            bluetooth.devices,
          ).find((d: AstalBluetooth.Device) => d.connected)
          return connected ? connected.name : "Bluetooth"
        },
      )}
      onClick={() => {
        bluetooth.adapter.powered = !bluetooth.adapter.powered
      }}
      popover={popover}
    />
  )
}
