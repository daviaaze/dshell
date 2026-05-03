import AstalBattery from "gi://AstalBattery";
import Gtk from "gi://Gtk?version=4.0";
import { createBinding, createComputed } from "gnim";

function fmtDuration(seconds: number): string {
  const abs = Math.abs(Math.round(seconds))
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

function fmtDurationHMS(seconds: number): string {
  const abs = Math.abs(Math.round(seconds))
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60
  return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`
}

export const BatteryIcon = () => {
  const battery = AstalBattery.get_default()
  const timeTo = createComputed([
    createBinding(battery, "charging"),
    createBinding(battery, "timeToEmpty"),
    createBinding(battery, "timeToFull")],
    (charging, timeToEmpty, timeToFull) =>
      charging ? timeToFull : timeToEmpty)

  return <Gtk.Box
    spacing={4}
    marginStart={8}
    marginEnd={8}
    hexpand
    halign={Gtk.Align.CENTER}
    visible={createBinding(battery, "isPresent")}>
    <Gtk.Image
      iconName={createBinding(battery, "iconName")}
      pixelSize={20}
    />
    <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
      <Gtk.Label
        label={createBinding(battery, "percentage")
          .as(p => (p * 100).toFixed(0) + "%")}
      />
      <Gtk.Label
        label={timeTo(timeTo =>
          timeTo === 0 ? "Full" :
            fmtDuration(timeTo) +
            (battery.get_charging() ? " to full" : " to empty")
        )}
      />
    </Gtk.Box>
  </Gtk.Box>
}

export const Battery = () => {
  const battery = AstalBattery.get_default()
  const timeTo = createComputed([
    createBinding(battery, "charging"),
    createBinding(battery, "timeToEmpty"),
    createBinding(battery, "timeToFull")],
    (charging, timeToEmpty, timeToFull) =>
      charging ? timeToFull : timeToEmpty)

  return <Gtk.Box
    orientation={Gtk.Orientation.VERTICAL}
    cssClasses={["card"]}
    spacing={4}
    visible={createBinding(battery, "isPresent")}
  >
    <Gtk.Label
      cssClasses={["title-3"]}
      label={"Battery Info"}
      halign={Gtk.Align.CENTER}
    />
    <Gtk.Label
      halign={Gtk.Align.START}
      label={timeTo(timeTo =>
        `${battery.get_charging() ?
          "Charged" : "Discharged"
        } in: ${fmtDurationHMS(timeTo)}`
      )}
    />
    <Gtk.Label
      halign={Gtk.Align.START}
      label={createBinding(battery, "energyRate")(rate =>
        `Rate of ${battery.get_charging() ?
          "Charge" : "discharge"
        }: ${rate.toFixed(2)}W`)}
    />
    <Gtk.Label
      halign={Gtk.Align.START}
      label={createBinding(battery, "energy")(energy =>
        `Energy: ${energy.toFixed(2)}/${battery.energyFull.toFixed(0)}Wh`)}
    />
    <Gtk.LevelBar
      value={createBinding(battery, "percentage")}
      widthRequest={100}
      heightRequest={50}>
      <Gtk.Label label={createBinding(battery, "percentage")
        .as(p => `${(p * 100).toFixed(0)}%`)} />
    </Gtk.LevelBar>
  </Gtk.Box>
}
