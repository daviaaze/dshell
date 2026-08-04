import Mpris from 'gi://AstalMpris';
import {cleanupNode, connectFor} from '@shade/core/connectFor';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Object, property, register} from 'gnim/gobject';

/**
 * MediaController — semantic command layer over AstalMpris.
 *
 * Widgets bind to reactive properties and call semantic methods;
 * they never call Mpris.Player.play(), .pause(), .next(), etc. directly.
 */
@register
export default class MediaController extends Object {
    private static instance: MediaController;

    static get_default(): MediaController {
        if (!MediaController.instance) MediaController.instance = new MediaController();
        return MediaController.instance;
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
        if (this.#activePlayer && this.#players.includes(this.#activePlayer)) {
            return; // player unchanged — properties will notify via signals
        }

        // Fall back to first player
        const p = this.#players[0] ?? null;
        this.#setActivePlayer(p);
    }

    #playerPropSignals: number[] = [];

    #setActivePlayer(player: Mpris.Player | null) {
        // Drop old signal connections
        for (const id of this.#playerPropSignals) {
            try {
                const old = this.#activePlayer;
                if (old) old.disconnect(id);
            } catch {
                /* ignore */
            }
        }
        this.#playerPropSignals = [];

        this.#activePlayer = player;
        this.notify('active-player');

        // Wire notify signals on the new player so metadata updates
        // are reflected in activeTitle / activeArtist / activeCoverArt
        if (player) {
            const ids = [
                player.connect('notify::title', () => this.#syncActiveMetadata()),
                player.connect('notify::artist', () => this.#syncActiveMetadata()),
                player.connect('notify::cover-art', () => this.#syncActiveMetadata()),
            ];
            this.#playerPropSignals.push(...ids);
        }

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

defineService({name: 'MediaController', service: MediaController.get_default()});
