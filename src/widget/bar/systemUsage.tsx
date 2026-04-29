import GTop from "gi://GTop";
import { useSettings } from "../../lib/settings";
import Gtk from "gi://Gtk?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import AstalIO from "gi://AstalIO?version=0.1";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { Accessor, createState, onCleanup } from "gnim";


export default ({ vertical }: { vertical: Accessor<boolean> }) => {
  const settings = useSettings()

  const [lastCpuTop, setLastCpuTop] = createState(new GTop.glibtop_cpu())
  const [cpu, setCpu] = createState(0)
  const [memory, setMemory] = createState(0)
  const [disk, setDisk] = createState(0)
  const [temp, setTemp] = createState(0)
  const INTERVAL = 1000;

  const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, INTERVAL, () => {
    const cpuTop = new GTop.glibtop_cpu()
    GTop.glibtop_get_cpu(cpuTop);
    const total = cpuTop.total - lastCpuTop.get().total;
    const user = cpuTop.user - lastCpuTop.get().user;
    const sys = cpuTop.sys - lastCpuTop.get().sys;
    const nice = cpuTop.nice - lastCpuTop.get().nice;
    setLastCpuTop(cpuTop)
    setCpu((user + sys + nice) / total);

    const memTop = new GTop.glibtop_mem()
    GTop.glibtop_get_mem(memTop);
    setMemory(memTop.user / memTop.total);

    const diskTop = new GTop.glibtop_fsusage()
    GTop.glibtop_get_fsusage(diskTop, "/");
    setDisk((diskTop.blocks - diskTop.bavail) / diskTop.blocks);

    const tempPath = settings.bar.tempPath.get()
    if (tempPath) {
      const file = Gio.File.new_for_path(tempPath)
      file.load_contents_async(null, (_source, res) => {
        try {
          const [success, contents] = file.load_contents_finish(res)
          if (success) {
            const value = parseInt(new TextDecoder().decode(contents))
            setTemp(value / 100000)
          }
        } catch (e: any) {
          print("failed to read temperature:", e.message)
          setTemp(-1)
        }
      })
    } else {
      setTemp(-1)
    }
    return GLib.SOURCE_CONTINUE
  })
  onCleanup(() => GLib.source_remove(timeoutId))

  const Indicator = ({ value, label, unit, vertical, visible = true }:
    {
      value: Accessor<number>,
      label: string,
      unit: string,
      vertical: Accessor<boolean>,
      visible?: Accessor<boolean> | boolean
    }) => <Gtk.Box
      visible={visible}
      spacing={2}
      orientation={Gtk.Orientation.VERTICAL}
    >
      <Gtk.Box
        spacing={vertical.as(v => v ? 0 : 4)}
        orientation={vertical.as(v => v ?
          Gtk.Orientation.VERTICAL :
          Gtk.Orientation.HORIZONTAL)}
      >
        <Gtk.Label
          label={label}
          cssClasses={["caption-heading", "numeral"]} />
        <Gtk.Label
          cssClasses={["caption", "numeral"]}
          label={value(v => (v * 100)
            .toFixed(0)
            .concat(unit))} />
      </Gtk.Box>
      <Gtk.LevelBar
        orientation={vertical.as(v => v ?
          Gtk.Orientation.VERTICAL :
          Gtk.Orientation.HORIZONTAL)}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
        inverted={vertical}
        value={value}
        widthRequest={vertical.as(v => v ? -1 : 50)}
        heightRequest={vertical.as(v => v ? 50 : -1)}
      />
    </Gtk.Box>

  return <Gtk.Button
    cursor={Gdk.Cursor.new_from_name("pointer", null)}
    onClicked={() =>
      settings.bar.systemMonitor ?
        AstalIO.Process.exec_async((
          settings.bar.systemMonitor as Accessor<any>)
          .get()
        ) : null}>
    <Gtk.Box
      orientation={vertical.as(v => v ?
        Gtk.Orientation.VERTICAL :
        Gtk.Orientation.HORIZONTAL)}
      spacing={12}>
      <Indicator
        vertical={vertical}
        value={cpu}
        label="CPU"
        unit="%" />
      <Indicator
        vertical={vertical}
        value={memory}
        label="RAM"
        unit="%" />
      <Indicator
        visible={temp.as(t => t >= 0)}
        vertical={vertical}
        value={temp}
        label="TEMP"
        unit="°C" />
      <Indicator
        vertical={vertical}
        visible={settings.bar.showDiskUsage}
        value={disk}
        label="DISK"
        unit="%" />
    </Gtk.Box>
  </Gtk.Button >
}