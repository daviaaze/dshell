import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { Accessor, createState } from "gnim"

type SliderProps = {
  icon: Accessor<string> | string
  visible?: Accessor<boolean> | boolean
  min: number
  max: number
  value: Accessor<number>
  setValue: (value: number) => void
  onIconClick?: () => void
}

const DEBOUNCE_MS = 80

export const Slider = (props: SliderProps) => {
  const safe = (v: number) => (Number.isFinite(v) ? v : 0)
  const [displayValue, setDisplayValue] = createState(safe(props.value()))
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let isExternalUpdate = false

  const debouncedSetValue = (value: number) => {
    // Don't propagate external volume changes back to PipeWire
    if (isExternalUpdate) return
    setDisplayValue(value)
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      props.setValue(value)
      debounceTimer = null
    }, DEBOUNCE_MS)
  }

  props.value.subscribe(() => {
    if (debounceTimer === null) {
      isExternalUpdate = true
      setDisplayValue(safe(props.value()))
      // Reset flag after Gnim renders and onChangeValue has been suppressed
      setTimeout(() => { isExternalUpdate = false }, 0)
    }
  })

  return (
    <Gtk.Box cssClasses={["slider"]} spacing={4} visible={props.visible}>
      {props.onIconClick ? (
        <Gtk.Button onClicked={props.onIconClick}>
          <Gtk.Image iconName={props.icon} />
        </Gtk.Button>
      ) : (
        <Gtk.Image iconName={props.icon} />
      )}
      <Astal.Slider
        hexpand
        min={props.min}
        max={props.max}
        $={(self) => self.set_value(safe(displayValue()))}
        onChangeValue={({ value }) => debouncedSetValue(safe(value))}
        value={displayValue}
      />
      <Gtk.Label
        cssClasses={["heading"]}
        label={displayValue((v) => (v ?? 0).toFixed(0).toString().concat("%"))}
      />
    </Gtk.Box>
  )
}
