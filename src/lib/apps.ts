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

// ── Helpers for getAppForClient ──

type ClientTerms = { cls: string | undefined; title: string | undefined; initialTitle: string | undefined }

/** Match a client property against a getter on each app in the list. */
function matchByGetter(
  allApps: Apps.Application[],
  terms: ClientTerms,
  getValue: (app: Apps.Application) => string,
): Apps.Application | null {
  for (const app of allApps) {
    const value = getValue(app)
    if (!value) continue
    if (value === terms.cls || value === terms.title || value === terms.initialTitle) {
      return app
    }
  }
  return null
}

/** Try AstalApps query on a client term, returning first result. */
function queryTerm(
  term: string | undefined,
  queryFn: (q: string) => Apps.Application[],
): Apps.Application | null {
  if (!term) return null
  const results = queryFn(term)
  return results.length > 0 ? results[0]! : null
}

export function getAppForClient(
  client: Hyprland.Client,
): Apps.Application | null {
  const terms: ClientTerms = {
    cls: client.class?.toLowerCase(),
    title: client.title?.toLowerCase(),
    initialTitle: client.initialTitle?.toLowerCase(),
  }

  if (!terms.cls && !terms.title) return null

  const allApps = getAppList()

  // 1. Exact desktop entry match
  const entryMatch = matchByGetter(allApps, terms, (a) => a.entry?.toLowerCase().replace(".desktop", "") ?? "")
  if (entryMatch) return entryMatch

  // 2. Exact AstalApps query
  const exactFromCls = queryTerm(terms.cls, exactQuery)
  if (exactFromCls) return exactFromCls
  const exactFromTitle = queryTerm(terms.title, exactQuery)
  if (exactFromTitle) return exactFromTitle

  // 3. Executable name match
  const execMatch = matchByGetter(allApps, terms, (a) => getExecutableName(a.executable))
  if (execMatch) return execMatch

  // 4. App name match
  const nameMatch = matchByGetter(allApps, terms, (a) => a.name?.toLowerCase() ?? "")
  if (nameMatch) return nameMatch

  // 5. Fuzzy query fallback
  const fuzzyFromCls = queryTerm(terms.cls, fuzzyQuery)
  if (fuzzyFromCls) return fuzzyFromCls
  const fuzzyFromTitle = queryTerm(terms.title, fuzzyQuery)
  if (fuzzyFromTitle) return fuzzyFromTitle

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
