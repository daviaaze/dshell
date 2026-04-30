import AstalIO from "gi://AstalIO?version=0.1"
import GLib from "gi://GLib?version=2.0"

export interface ClipboardItem {
  id: string
  text: string
  timestamp: number
}

const MAX_HISTORY = 500
const IGNORED_CLASSES = [
  "keepassxc", "bitwarden", "1password", "seahorse", "gnome-keyring", "enpass"
]

function parseCliphist(output: string): ClipboardItem[] {
  const lines = output.trim().split("\n")
  const items: ClipboardItem[] = []
  for (const line of lines) {
    const tabIndex = line.indexOf("\t")
    if (tabIndex === -1) continue
    const id = line.slice(0, tabIndex).trim()
    const text = line.slice(tabIndex + 1).trim()
    if (id && text) {
      items.push({ id, text, timestamp: Date.now() })
    }
  }
  return items
}

export function getClipboardHistory(): ClipboardItem[] {
  try {
    const out = AstalIO.Process.exec("cliphist list")
    return parseCliphist(out)
  } catch (e) {
    print("[Clipboard] failed to get history:", (e as Error).message)
    return []
  }
}

export function searchClipboard(query: string): ClipboardItem[] {
  const items = getClipboardHistory()
  if (!query) return items.slice(0, 20)
  const lower = query.toLowerCase()
  return items
    .filter(item => item.text.toLowerCase().includes(lower))
    .slice(0, 20)
}

export function copyClipboardItem(id: string) {
  try {
    AstalIO.Process.exec_async(
      `cliphist decode ${id} | wl-copy`,
      () => {}
    )
  } catch (e) {
    print("[Clipboard] failed to copy item:", (e as Error).message)
  }
}

export function deleteClipboardItem(id: string) {
  try {
    AstalIO.Process.exec_async(
      `cliphist delete ${id}`,
      () => {}
    )
  } catch (e) {
    print("[Clipboard] failed to delete item:", (e as Error).message)
  }
}

export function clearClipboardHistory() {
  try {
    AstalIO.Process.exec_async(
      `cliphist wipe`,
      () => {}
    )
  } catch (e) {
    print("[Clipboard] failed to clear history:", (e as Error).message)
  }
}

export function isImageEntry(text: string): boolean {
  return text.startsWith("[[ binary data ") || text.includes("image/png") || text.includes("image/jpeg")
}

export function formatClipboardPreview(text: string, maxLen = 60): string {
  if (isImageEntry(text)) return "[Image]"
  if (text.length > maxLen) return text.slice(0, maxLen) + "..."
  return text
}
