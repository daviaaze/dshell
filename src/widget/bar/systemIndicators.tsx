import Bluetooth from "gi://AstalBluetooth"
import Notifd from "gi://AstalNotifd"
import Network from "gi://AstalNetwork"
import Batery from "gi://AstalBattery"
import Wireplumber from "gi://AstalWp"
import PowerProf from "gi://AstalPowerProfiles"
import AutoCpufreq, { iconForProfile } from "#/lib/autoCpufreq"
import Screenshot from "#/lib/screenshot"
import Gdk from "gi://Gdk?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { Accessor, createBinding, createComputed } from "gnim"
import { qsOpen, setQsOpen } from ".."

const MUTED_SPEAKER_ICON = "audio-volume-muted-symbolic"
const MUTED_MIC_ICON = "microphone-sensitivity-muted-symbolic"

export default ({ vertical }: { vertical: Accessor<boolean> }) => {
  const audio = Wireplumber.get_default()!.audio
  const battery = Batery.get_default()
  const network = Network.get_default()
  const powerprof = PowerProf.get_default()
  const autoCpufreq = AutoCpufreq.get_default()
  const notifd = Notifd.get_default()
  const bluetooth = Bluetooth.get_default()

  const ProfileIndicator = () => {
    if (autoCpufreq.available) {
      return <Gtk.Image
        visible={createBinding(autoCpufreq, "activeProfile")
          .as(p => p !== "balanced")}
        iconName={createBinding(autoCpufreq, "activeProfile").as(iconForProfile)}
        tooltipMarkup={createBinding(autoCpufreq, "activeProfile")
          .as(String)}
        pixelSize={18} />
    }
    return <Gtk.Image
      visible={createBinding(powerprof, "activeProfile")
        .as(p => p !== "balanced")}
      iconName={createBinding(powerprof, "iconName")}
      tooltipMarkup={createBinding(powerprof, "activeProfile")
        .as(String)}
      pixelSize={18} />
  }

  const DNDIndicator = () => <Gtk.Image
    visible={createBinding(notifd, "dontDisturb")}
    iconName="notifications-disabled-symbolic"
    pixelSize={18} />

  const BluetoothIndicator = () => {
    const isConnected = createBinding(bluetooth, "devices")
      .as(devices => {
        if (!devices) return false
        const arr = Array.isArray(devices) ? devices : Array.from(devices)
        return arr.some((d: any) => d.connected)
      })
    const tooltip = createBinding(bluetooth, "devices")
      .as(devices => {
        if (!devices) return ""
        const arr = Array.isArray(devices) ? devices : Array.from(devices)
        const connected = arr.filter((d: any) => d.connected).map((d: any) => d.name)
        return connected.length > 0 ? connected.join(", ") : "Bluetooth"
      })

    return <Gtk.Image
      iconName={isConnected.as(c => c
        ? "bluetooth-active-symbolic"
        : "bluetooth-symbolic")}
      visible={createBinding(bluetooth, "adapter")
        .as(adapter => adapter && adapter.powered)}
      tooltipMarkup={tooltip}
      pixelSize={18} />
  }

  const NetworkIndicator = () => {
    const icon = createComputed([
      createBinding(network, "primary"),
      createBinding(network, "wifi"),
      createBinding(network, "wired")],
      (primary, wifi, wired) => {
        if (primary === Network.Primary.WIFI) {
          return wifi?.iconName || "network-wireless-offline-symbolic"
        }
        if (primary === Network.Primary.WIRED) {
          return wired?.iconName || "network-wired-offline-symbolic"
        }
        return "network-no-route-symbolic"
      })
    return <Gtk.Image
      iconName={icon}
      visible={createBinding(network, "primary")
        .as(p => p !== Network.Primary.UNKNOWN)}
      pixelSize={18} />
  }

  const getAudioIcon = (device: Wireplumber.Endpoint, mutedIcon: string) =>
    createComputed([
      createBinding(device, "volume"),
      createBinding(device, "mute"),
      createBinding(device, "volumeIcon"),
    ], (volume, mute, volumeIcon) =>
      (mute || volume === 0) ? mutedIcon : volumeIcon
    )

  const AudioIndicator = () => <Gtk.Image
    visible={createBinding(audio, "speakers")
      .as(rec => rec.length > 0)}
    iconName={getAudioIcon(audio.default_speaker, MUTED_SPEAKER_ICON)}
    tooltipMarkup={createBinding(audio.default_speaker, "volume")
      .as(v => "Volume: " + (v * 100).toFixed(0).toString() + "%")}
    pixelSize={18} />

  const MicrophoneIndicator = () => <Gtk.Image
    visible={createBinding(audio, "recorders")
      .as(rec => rec.length > 0)}
    iconName={getAudioIcon(audio.default_microphone, MUTED_MIC_ICON)}
    tooltipMarkup={createBinding(audio.default_microphone, "volume")
      .as(v => (v * 100).toFixed(0).toString() + "%")}
    pixelSize={18} />

  const BatteryIndicator = () => <Gtk.Image
    visible={createBinding(battery, "is_present")}
    iconName={createBinding(battery, "batteryIconName")}
    tooltipMarkup={createBinding(battery, "percentage")
      .as((p) => (p * 100).toFixed(0).toString() + "%")}
    cssClasses={createBinding(battery, "warning_level").as(level => {
      if (level === Batery.WarningLevel.CRITICIAL ||
          level === Batery.WarningLevel.ACTION)
        return ["error"]
      if (level === Batery.WarningLevel.LOW ||
          level === Batery.WarningLevel.DISCHARGING)
        return ["warning"]
      return []
    })}
    pixelSize={18} />

  const RecordingIndicator = () => <Gtk.Image
    visible={createBinding(Screenshot.get_default(), "recording")}
    iconName="media-record-symbolic"
    cssClasses={["error"]}
    pixelSize={18} />

  return <Gtk.ToggleButton
    cursor={Gdk.Cursor.new_from_name("pointer", null)}
    active={qsOpen}
    onClicked={() => setQsOpen(!qsOpen.get())}
    $={self => self.add_controller(
      <Gtk.EventControllerScroll
        flags={Gtk.EventControllerScrollFlags.VERTICAL}
        onScroll={(self, dx, dy) => {
          if (dy > 0)
            audio.default_speaker.volume -= 0.025
          else
            audio.default_speaker.volume += 0.025
        }}
      /> as Gtk.EventController)}>
    <Gtk.Box
      spacing={4}
      orientation={vertical.as(v => v ?
        Gtk.Orientation.VERTICAL :
        Gtk.Orientation.HORIZONTAL)}>
      <RecordingIndicator />
      <ProfileIndicator />
      <BluetoothIndicator />
      <NetworkIndicator />
      <BatteryIndicator />
      <MicrophoneIndicator />
      <AudioIndicator />
      <DNDIndicator />
    </Gtk.Box>
  </Gtk.ToggleButton>
}
