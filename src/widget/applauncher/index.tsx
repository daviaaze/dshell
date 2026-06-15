import Hyprland from "gi://AstalHyprland"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import { createBinding, createState, For } from "gnim"
import AppButton from "./appButton"
import ClipboardButton from "./clipboardButton"
import { searchClipboard } from "#/lib/clipboard"
import { getAppList, fuzzyQuery } from "#/lib/apps"
import { useSettings } from "#/lib/settings"
import { app } from "#/App"
import WindowManager from "#/lib/windowManager"
import ShellState from "#/lib/shellState"
import logger from "#/lib/logger"
import Apps from "gi://AstalApps"
import type { ClipboardItem } from "#/lib/clipboard"

const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

type LauncherMode = "apps" | "clipboard"
type ListItem = Apps.Application | ClipboardItem

function isApp(item: ListItem): item is Apps.Application {
  return "entry" in item
}

export default () => {
  const barCfg = useSettings().bar
  const hyprland = Hyprland.get_default()
  const [list, setList] = createState<ListItem[]>(getAppList())
  const [mode, setMode] = createState<LauncherMode>("apps")
  let entryRef: Gtk.Entry | null = null

  const updateSearch = (text: string) => {
    if (text.startsWith(">")) {
      setMode("clipboard")
      const query = text.slice(1).trim()
      searchClipboard(query, (results) => {
        setList(results)
      })
    } else {
      setMode("apps")
      setList(fuzzyQuery(text))
    }
  }

  return (
    <Astal.Window
      $={(self) => {
        WindowManager.get_default().setApplauncher(self)
        self.connect("realize", () => logger.log("applauncher realized"))
        self.connect("map", () => logger.log("applauncher mapped"))
      }}
      valign={Gtk.Align.CENTER}
      name={"applauncher"}
      margin={12}
      application={app}
      visible={createBinding(ShellState.get_default(), "launcherOpen")}
      onNotifyVisible={(self) => {
        logger.log(`applauncher visible -> ${self.visible}`)
        if (
          (barCfg.position() === LEFT || barCfg.position() === RIGHT) &&
          self.visible &&
          ShellState.get_default().qsOpen
        )
          ShellState.get_default().qsOpen = false
        if (self.visible) {
          const query = ShellState.get_default().launcherQuery
          if (query && entryRef) {
            entryRef.set_text(query)
          }
          entryRef?.grab_focus()
        } else {
          entryRef?.set_text("")
          setList(getAppList())
          setMode("apps")
          ShellState.get_default().launcherQuery = ""
        }
        ShellState.get_default().launcherOpen = self.visible
      }}
      cssClasses={["card", "frame", "background"]}
      css={"padding-right:0px;"}
      keymode={Astal.Keymode.ON_DEMAND}
      monitor={createBinding(hyprland, "focusedMonitor").as((m) => m.id)}
      anchor={barCfg.position.as(
        (p) => TOP | (p === RIGHT ? RIGHT : LEFT) | BOTTOM,
      )}
    >
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["applauncher-body"]}
        spacing={8}
      >
        <Gtk.Entry
          hexpand
          css={"margin-right:4px;"}
          placeholderText={mode.as((m) =>
            m === "clipboard"
              ? "Search clipboard history..."
              : "Search your apps",
          )}
          $={(self) => {
            entryRef = self
          }}
          onNotifyText={(self) => updateSearch(self.text)}
          onActivate={(self) => {
            WindowManager.get_default().applauncher!.visible = false
            if (mode() === "apps") {
              const results = fuzzyQuery(self.text)
              if (results.length > 0) results[0].launch()
            }
          }}
        >
          <Gtk.EventControllerKey
            $={(self) => {
              self.connect("key-pressed", (_, keyval) => {
                if (keyval === Gdk.KEY_Escape) {
                  WindowManager.get_default().applauncher!.visible = false
                  return true
                }
                return false
              })
            }}
          />
        </Gtk.Entry>
        <Gtk.Label
          visible={mode.as((m) => m === "clipboard")}
          halign={Gtk.Align.START}
          marginStart={4}
          cssClasses={["caption"]}
          label="Clipboard History — type &gt; to search"
        />
        <Gtk.ScrolledWindow
          css={"padding-right:0px;"}
          hscrollbarPolicy={Gtk.PolicyType.NEVER}
          propagateNaturalHeight
        >
          <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            css={"padding-right: 12px;"}
            spacing={8}
          >
            <Gtk.Label
              visible={list.as((l) => l.length === 0)}
              cssClasses={["title-3"]}
              marginTop={24}
              marginBottom={24}
              label={mode.as((m) =>
                m === "clipboard" ? "No clipboard items" : "No apps found",
              )}
            />
            <For each={list}>
              {(item: ListItem) =>
                mode() === "clipboard" ? (
                  <ClipboardButton item={item as ClipboardItem} />
                ) : (
                  <AppButton application={item as Apps.Application} />
                )
              }
            </For>
          </Gtk.Box>
        </Gtk.ScrolledWindow>
      </Gtk.Box>
    </Astal.Window>
  )
}
