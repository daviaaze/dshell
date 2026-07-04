import logger from "#/lib/logger"
import { Process } from "#/lib/process"

export interface ClipboardItem {
  id: string
  text: string
  timestamp: number
}

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

export async function getClipboardHistory(
  callback: (items: ClipboardItem[]) => void,
) {
  try {
    const out = await Process.execAsync("cliphist list")
    callback(parseCliphist(out))
  } catch (e) {
    logger.error("clipboard", "failed to get history:", e)
    callback([])
  }
}

export async function searchClipboard(
  query: string,
  callback: (items: ClipboardItem[]) => void,
) {
  await getClipboardHistory((items) => {
    if (!query) return callback(items.slice(0, 20))
    const lower = query.toLowerCase()
    callback(
      items.filter((item) => item.text.toLowerCase().includes(lower)).slice(0, 20),
    )
  })
}

export async function copyClipboardItem(id: string) {
  try {
    await Process.execAsync(`sh -c 'cliphist decode "${id}" | wl-copy'`)
  } catch (e) {
    logger.error("clipboard", "failed to copy item:", e)
  }
}

export async function deleteClipboardItem(id: string) {
  try {
    await Process.execAsync(`cliphist delete "${id}"`)
  } catch (e) {
    logger.error("clipboard", "failed to delete item:", e)
  }
}

export function isImageEntry(text: string): boolean {
  return (
    text.startsWith("[[ binary data ") ||
    text.includes("image/png") ||
    text.includes("image/jpeg")
  )
}

export function formatClipboardPreview(text: string, maxLen = 60): string {
  if (isImageEntry(text)) return "[Image]"
  if (text.length > maxLen) return text.slice(0, maxLen) + "..."
  return text
}