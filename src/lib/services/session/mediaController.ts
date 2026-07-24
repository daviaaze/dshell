import {Object, register, property} from 'gnim/gobject';
import Mpris from 'gi://AstalMpris';
import logger from '#/lib/core/logger';
import {connectFor, cleanupNode} from '#/lib/core/connectFor';

/**
 * MediaController — semantic command layer over AstalMpris.
 *
 * Widgets bind to reactive properties and call semantic methods;
 * they never call Mpris.Player.play(), .pause(), .next(), etc. directly.
 */
@register({GTypeName: 'MediaController'})
export default class MediaController extends Object {
    static instance: MediaController;

    static get_default(): MediaController {
        if (!this.instance) this.instance = new MediaController();
        return this.instance;
    }

    #mpris: Mpris.Mpris | null = null;
    #players: Mpris.Player[] = [];
    #activePlayer: Mpris.Player | null = null;
    #activeTitle = '';
    #activeArtist = '';
    #activeCoverArt = '';
    #listening = false;
    #hn: Record<string, number> = {};

    @property
    get mpris(): Mpris.Mpris | null {
        return this.#mpris;
    }

    @property
    get players(): Mpris.Player[] {
        return this.#players;
    }

    @property
    get activePlayer(): Mpris.Player | null {
        return this.#activePlayer;
    }

    @property
    get activeTitle(): string {
        return this.#activeTitle;
    }

    @property
    get activeArtist(): string {
        return this.#activeArtist;
    }

    @property
    get activeCoverArt(): string {
        return this.#activeCoverArt;
    }

    // ── Lifecycle ──

    /** Initialize the MPRIS D-Bus proxy. Call once during boot. */
    init() {
        if (this.#listening) return;
        this.#listening = true;

        try {
            this.#mpris = Mpris.get_default();
        } catch (e) {
            logger.warn('mediaController', 'Failed to init Mpris:', e);
            return;
        }

        this.#hn = {};
        connectFor(this.#hn, this.#mpris!, 'notify::players', () => {
            this.#onPlayersChanged();
        });
        this.#onPlayersChanged();
    }

    #onPlayersChanged() {
        this.#players = this.#mpris?.players ?? [];
        this.notify('players');
        this.#updateActivePlayer();
    }

    #updateActivePlayer() {
        // Keep existing active player if still in the list
        if (
            this.#activePlayer &&
            this.#players.includes(this.#activePlayer)
        ) {
            return; // player unchanged — properties will notify via signals
        }

        // Fall back to first player
        const p = this.#players[0] ?? null;
        this.#setActivePlayer(p);
    }

    #setActivePlayer(player: Mpris.Player | null) {
        // Old player cleanup happens via tracked HN if needed
        this.#activePlayer = player;
        this.notify('active-player');
        this.#syncActiveMetadata();
    }

    #syncActiveMetadata() {
        const p = this.#activePlayer;
        this.#activeTitle = p?.title ?? '';
        this.#activeArtist = p?.artist ?? '';
        this.#activeCoverArt = p?.coverArt ?? '';
        this.notify('active-title');
        this.notify('active-artist');
        this.notify('active-cover-art');
    }

    /** Select a specific player as active (e.g. from quicksettings UI). */
    setActivePlayer(player: Mpris.Player) {
        if (player !== this.#activePlayer) {
            this.#setActivePlayer(player);
        }
    }

    // ── Semantic command methods ──

    playPause() {
        this.#activePlayer?.play_pause();
    }

    next() {
        this.#activePlayer?.next();
    }

    previous() {
        this.#activePlayer?.previous();
    }

    seek(position: number) {
        if (this.#activePlayer) {
            this.#activePlayer.position = position;
        }
    }

    dispose() {
        cleanupNode(this.#hn);
        this.#hn = {};
        this.#mpris = null;
        this.#players = [];
        this.#activePlayer = null;
    }
}
