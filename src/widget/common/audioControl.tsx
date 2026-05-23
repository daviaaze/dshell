import Wireplumber from "gi://AstalWp"
import Gtk from "gi://Gtk?version=4.0"
import { Accessor, createBinding, createState, For, With } from "gnim"
import { Slider } from "./slider"
import { getVolumeIcon } from "#/lib/audio"
import AppMixer from "#/widget/quicksettings/appMixer"

export { getVolumeIcon }

interface AudioControlProps {
  defaultDevice: Accessor<Wireplumber.Endpoint | null>
  devices: Accessor<Wireplumber.Endpoint[]>
  visible?: Accessor<boolean> | boolean
  mutedIcon: string
  showAppMixer?: boolean
}

export const AudioEndpointControl = ({
  defaultDevice,
  devices,
  visible,
  mutedIcon,
  showAppMixer,
}: AudioControlProps) => {
  const [revealed, setRevealed] = createState(false)
  const [tab, setTab] = createState<"devices" | "apps">("devices")
  const radioGroup = new Gtk.CheckButton()

  const DeviceWidget = ({ device }: { device: Wireplumber.Endpoint }) => (
    <Gtk.Box spacing={8} orientation={Gtk.Orientation.VERTICAL}>
      <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
        <Gtk.CheckButton
          group={radioGroup}
          active={createBinding(device, "isDefault")}
          onNotifyActive={({ active }) => {
            if (active) device.isDefault = true
          }}
        />
        <Gtk.Label
          label={device.description}
          maxWidthChars={30}
          ellipsize={3}
          hexpand
          halign={Gtk.Align.START}
          cssClasses={["body"]}
        />
      </Gtk.Box>
      <Slider
        min={0}
        max={100}
        icon={getVolumeIcon(device, mutedIcon)}
        value={createBinding(device, "volume").as((v) => v * 100)}
        setValue={(value) => device.set_volume(value / 100)}
      />
    </Gtk.Box>
  )

  const DevicesList = () => (
    <Gtk.Box
      cssClasses={["card", "popover-padded"]}
      spacing={12}
      orientation={Gtk.Orientation.VERTICAL}
    >
      <For each={devices}>{(d) => <DeviceWidget device={d} />}</For>
    </Gtk.Box>
  )

  const TabbedContent = () => (
    <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
      <Gtk.Box spacing={0} halign={Gtk.Align.CENTER} cssClasses={["linked"]}>
        <Gtk.ToggleButton
          active={tab.as((t) => t === "devices")}
          onClicked={() => setTab("devices")}
          label="Devices"
        />
        <Gtk.ToggleButton
          active={tab.as((t) => t === "apps")}
          onClicked={() => setTab("apps")}
          label="Applications"
        />
      </Gtk.Box>
      <Gtk.Box
        visible={tab.as((t) => t === "devices")}
        cssClasses={["card", "popover-padded"]}
        spacing={12}
        orientation={Gtk.Orientation.VERTICAL}
      >
        <For each={devices}>{(d) => <DeviceWidget device={d} />}</For>
      </Gtk.Box>
      <Gtk.Box
        visible={tab.as((t) => t === "apps")}
        cssClasses={["card", "popover-padded"]}
        spacing={12}
        orientation={Gtk.Orientation.VERTICAL}
      >
        <AppMixer />
      </Gtk.Box>
    </Gtk.Box>
  )

  return (
    <Gtk.Box
      visible={visible}
      spacing={4}
      cssClasses={["audio-config"]}
      orientation={Gtk.Orientation.VERTICAL}
    >
      <Gtk.Box spacing={4}>
        <With value={defaultDevice}>
          {(device) =>
            device ? (
              <Slider
                icon={getVolumeIcon(device, mutedIcon)}
                min={0}
                max={100}
                value={createBinding(device, "volume").as((v) => v * 100)}
                setValue={(value) => device.set_volume(value / 100)}
              />
            ) : null
          }
        </With>
        <Gtk.Button
          onClicked={() => setRevealed(!revealed.get())}
          iconName={revealed.as((v) =>
            v ? "go-up-symbolic" : "go-down-symbolic",
          )}
        />
      </Gtk.Box>
      <Gtk.Revealer revealChild={revealed}>
        {showAppMixer ? <TabbedContent /> : <DevicesList />}
      </Gtk.Revealer>
    </Gtk.Box>
  )
}
