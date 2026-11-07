# Share picker

Sources: standalone application [`main.ts`](../../apps/share-picker/src/main.ts), UI [`ui.ts`](../../apps/share-picker/src/ui.ts), capture/protocol/polling modules in [`apps/share-picker/src/`](../../apps/share-picker/src/).

XDPH launches a standalone GTK application, not a shell widget or settings page. Screens, Windows and All tabs show sources/previews. Clicking a source enters a review screen; it does not submit a selection. Review explains exposure and portal ownership, offers choose-another/Back, Cancel, and explicit Share. Before submission Share revalidates that the selected monitor/window still exists. Only then does the app write one `[SELECTION][r]/screen:NAME` or `[SELECTION][r]/window:ID` line to stdout and quit. `r` reflects the per-request restore-token checkbox/`--allow-token`; it is not a persistent shell preference. Cancel and window close quit without selection output. Preview absence does not prevent choosing a source and does not authorize transmission; requester/portal manage the session after selection.

Source cards retain a stable accessible identity while their preview loads or becomes unavailable. The native source grid adapts down to one column; preview status is separate from the source name.

The fixed action row remains outside the review viewport so Back, Cancel and Share stay reachable when a long window title or preview exceeds the available height. The heading and summary are bounded visually; their complete text remains available by tooltip.

The configured XDPH package passes the portal session handle as `XDPH_SESSION_HANDLE`. The picker watches the original requester's unique session-bus name, waits for its initial ownership check before enabling submission, and exits without a selection if that requester disappears. The application stays alive while awaiting the asynchronous check; shutdown removes the watch and preview resources. Malformed portal metadata fails closed. Invocations without portal metadata remain standalone protocol invocations. This handles requester disappearance; it does not claim to make XDPH's synchronous picker call generally asynchronous or fix every cancellation from a still-connected requester.

Manual: invoke through XDPH on a suitable session; inspect previews/tabs, select then review, choose another, cancel and close while confirming no selection line; explicitly share a live source and inspect stdout protocol. Test stale-source rejection and restore-token request state. Proposed checks, not new VM results.
