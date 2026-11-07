# Settings

Source-linked reference, not a claim of runtime verification. Sources: [`index.tsx`](../../packages/widgets/src/settings/index.tsx), [`settingsOpen.ts`](../../packages/widgets/src/settings/settingsOpen.ts), feature pages under `../../packages/widgets/src/settings/`.

## Navigation and lifecycle

Settings is a lazily rendered native `Adw.ApplicationWindow`, composed with `Adw.NavigationSplitView` and a `Gtk.Stack`; it is not an `Adw.PreferencesWindow`. The sidebar has 13 task rows; their 21 content modules remain mounted in the stack, so module-local subscriptions/lifecycles are not recreated just by navigating. Sidebar task titles group related modules, rather than defining a separate category/content count.

| Task | Modules |
|---|---|
| Aparência | Aparência |
| Barra e dock | Barra e dock |
| Telas | Telas |
| Som | Som |
| Mouse e touchpad | Mouse e touchpad |
| Conexões | Conexões, Bluetooth |
| Bloqueio e energia | Bloqueio e energia, Energia |
| Notificações | Notificações, Não perturbe |
| Captura e compartilhamento | Captura de tela, Compartilhamento de tela |
| Aplicativos | Aplicativos padrão, Aplicativos ao entrar |
| Tempo e concentração | Relógio, Clima, Temporizador |
| Atalhos | Atalhos |
| Sistema e diagnóstico | Sobre o sistema, Diagnóstico |

Search is one `Gtk.SearchEntry` outside the split. It searches task metadata and visible native page labels, subtitles, buttons and tooltips; matching results navigate to the relevant module/control. Exact module-title matches rank first; Enter opens the first current result, including when the search debounce has not fired. `Ctrl+F` focuses search. Back returns to the originating section/search result, and in collapsed layout returns to the sidebar. Escape from a search-opened destination preserves the query and returns to its results instead of clearing it. The native content page announces the same current title as the common header. `openSettings(destination?)` routes in the same window; when already visible it navigates/presents that window. Opening closes shell transient surfaces and is refused while `screenlocked`; close disposes the rendered tree. A hidden old instance is closed/disposed before replacement.

## Ownership and invariants

Feature pages and their service/schema own setting persistence and effects; the navigation shell does not promise every control has the same write semantics. In particular, Displays preview/confirmation/timed rollback belongs to `LayoutService`; startup-app writes preserve unrelated keyfile entries and reconcile failures; media defaults operate only on readable supported formats; sound controls reflect live endpoint membership/state. Consult the owning page/service before making backend claims.

## Manual verification

On a suitable unlocked GTK/Hyprland session: open Settings from the shell and from a routed entry point; navigate all 13 tasks and verify the intended 21 modules; search by page and control label, open a result, use Back, clear search, and test `Ctrl+F`. Repeat at narrow width, close/reopen and inspect lifecycle. For persistence claims, change one concrete setting and inspect its owning service/backend state; for display changes verify preview, confirm and rollback. These are proposed checks, not new VM results.
