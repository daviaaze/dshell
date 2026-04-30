import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { Accessor, createState, onCleanup } from "gnim"

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
  const [displayValue, setDisplayValue] = createState(props.value.get())
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const debouncedSetValue = (value: number) => {
    setDisplayValue(value)
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      props.setValue(value)
      debounceTimer = null
    }, DEBOUNCE_MS)
  }

  const unsub = props.value.subscribe((v) => {
    if (debounceTimer === null) setDisplayValue(v)
  })

  onCleanup(() => unsub())

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
        $={self => self.set_value(displayValue.get())}
        onChangeValue={({ value }) => debouncedSetValue(value)}
        value={displayValue} />
      <Gtk.Label
        cssClasses={["heading"]}
        label={displayValue(v => v
          .toFixed(0)
          .toString()
          .concat("%"))
        } />
    </Gtk.Box>
  )
}
