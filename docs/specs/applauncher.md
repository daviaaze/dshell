# Application launcher

Sources: [`index.tsx`](../../packages/widgets/src/applauncher/index.tsx), [`launcher.ts`](../../packages/services/src/search/launcher.ts), [`shellState.ts`](../../packages/services/src/state/shellState.ts).

The focused-monitor `Astal.Window` is opened through shell state, uses on-demand keyboard input and follows the bar-side full-height anchor. Width is capped at 640 logical pixels and clamped for monitor scale/width, 4px window margins and vertical-bar reserve. Showing restores the shell query, focuses the entry and refreshes results; hiding clears the entry, resets apps mode and emits the close event. Escape hides. In apps mode, Enter launches the first fuzzy match; clipboard mode is entered by the shell's `>` query marker and displays clipboard-history results. Search uses `launcherSearch`; app and clipboard result actions are rendered by separate button components.

Clipboard history identifies image entries from their MIME type instead of rendering the stored image base64 as text. Long text/IDs are ellipsized to the launcher width; the full text item remains available as a tooltip and clipboard activation still copies the stored entry.

The app search placeholder is **Pesquisar aplicativos**; clipboard mode uses **Pesquisar no histórico da área de transferência...** and the heading **Histórico da área de transferência — digite > para pesquisar**. The app list headings distinguish **Apps mais usados** from **Resultados da pesquisa (priorizados por uso)**. Empty results show **Nenhum aplicativo encontrado** or **Nenhum resultado no histórico da área de transferência**, with **Tente outro termo de pesquisa** or **Copie algo para vê-lo aqui** as applicable.

Manual: open by configured shell action, type app names and activate a result; try no-match state, Escape/reopen, and clipboard mode using its actual shell route. Repeat with a vertical bar and scaled/narrow monitor. These procedures are not new VM results.
