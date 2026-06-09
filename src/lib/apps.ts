import Apps from "gi://AstalApps"
import Hyprland from "gi://AstalHyprland"
import { toArray } from "#/lib/gjsUtils"

const apps = new Apps.Apps({
  nameMultiplier: 4,
  entryMultiplier: 2,
  executableMultiplier: 2,
  descriptionMultiplier: 1,
})

const CLASS_OVERRIDES: Record<string, string> = {
  "code-url-handler": "vscode",
}

export function getAppList(): Apps.Application[] {
  return toArray<Apps.Application>(apps.get_list())
}

export function fuzzyQuery(query: string): Apps.Application[] {
  return toArray<Apps.Application>(apps.fuzzy_query(query))
}

export function exactQuery(query: string): Apps.Application[] {
  return toArray<Apps.Application>(apps.exact_query(query))
}

function getExecutableName(exec: string): string {
  if (!exec) 
    return ""
  const base = exec.split("/").pop() || exec
  return base.split(" ")[0]!.toLowerCase()
}

export function getAppForClient(
  client: Hyprland.Client,
): Apps.Application | null {
  const cls = client.class?.toLowerCase()
  const title = client.title?.toLowerCase()
  const initialTitle = client.initialTitle?.toLowerCase()

  if (!cls && !title) return null

  const allApps = getAppList()

  for (const app of allApps) {
    const entry = app.entry?.toLowerCase().replace(".desktop", "")
    if (entry && (entry === cls || entry === title || entry === initialTitle)) {
      return app
    }
  }

  if (cls) {
    const exact = exactQuery(cls)
    if (exact.length > 0) return exact[0]!
  }
  if (title) {
    const exact = exactQuery(title)
    if (exact.length > 0) return exact[0]!
  }

  for (const app of allApps) {
    const exec = getExecutableName(app.executable)
    if (exec && (exec === cls || exec === title || exec === initialTitle)) {
      return app
    }
  }

  for (const app of allApps) {
    const name = app.name?.toLowerCase()
    if (name && (name === cls || name === title || name === initialTitle)) {
      return app
    }
  }

  if (cls) {
    const fuzzy = fuzzyQuery(cls)
    if (fuzzy.length > 0) return fuzzy[0]!
  }
  if (title) {
    const fuzzy = fuzzyQuery(title)
    if (fuzzy.length > 0) return fuzzy[0]!
  }

  return null
}

export function getAppIcon(client: Hyprland.Client): string {
  const cls = client.class
  if (cls && CLASS_OVERRIDES[cls]) {
    return CLASS_OVERRIDES[cls]
  }

  const app = getAppForClient(client)
  return app?.iconName || "image-missing-symbolic"
}

export function getDesktopFileForClient(
  client: Hyprland.Client,
): string | null {
  const app = getAppForClient(client)
  return app?.entry || null
}
