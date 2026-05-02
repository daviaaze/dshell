import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { Accessor, createState, onCleanup, onMount } from "gnim"

type SliderProps = {
  icon: Accessor<string> | string,
  visible?: Accessor<boolean> | boolean,
  min: number,
  max: number,
  value: Accessor<number>,
  setValue: (value: number) => void,
}

const DEBOUNCE_MS = 80

export const Slider = (props: SliderProps) => {
  const [displayValue, setDisplayValue] = createState(props.value.get() ?? 0)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let slider: Astal.Slider | null = null
  let mountTimer: number | null = null

  const debouncedSetValue = (value: number) => {
    setDisplayValue(value)
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      props.setValue(value)
      debounceTimer = null
    }, DEBOUNCE_MS)
  }

  const unsub = props.value.subscribe((v) => {
    if (debounceTimer === null) {
      setDisplayValue(v ?? 0)
      slider?.set_value(v ?? 0)
    }
  })

  onMount(() => {
    mountTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
      const v = props.value.get() ?? 0
      if (v !== displayValue.get()) {
        setDisplayValue(v)
        slider?.set_value(v)
      }
      mountTimer = null
      return GLib.SOURCE_REMOVE
    })
  })

  onCleanup(() => {
    unsub()
    if (mountTimer !== null) GLib.source_remove(mountTimer)
  })

  return (
    <Gtk.Box
      cssClasses={["slider"]}
      spacing={4}
      visible={props.visible}>
      <Gtk.Image iconName={props.icon} />
      <Astal.Slider
        hexpand
        min={props.min}
        max={props.max}
        value={displayValue}
        $={self => {
          slider = self
          self.set_value(displayValue.get() ?? 0)
        }}
        onChangeValue={({ value }) => debouncedSetValue(value)} />
      <Gtk.Label
        cssClasses={["heading"]}
        label={displayValue(v => (v ?? 0)
          .toFixed(0)
          .toString()
          .concat("%"))
        } />
    </Gtk.Box>
  )
}
