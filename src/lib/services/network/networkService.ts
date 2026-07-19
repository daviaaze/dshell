/**
 * Network service — wraps AstalNetwork D-Bus proxy with reactive properties.
 *
 * Handles the lazy D-Bus initialization of the wifi device proxy
 * so widgets only need to bind to reactive properties.
 */
import GObject, {getter, register} from 'gnim/gobject';
import Network from 'gi://AstalNetwork';
import logger from '#/lib/core/logger';

let _instance: NetworkService | null = null;

@register({GTypeName: 'NetworkService'})
export default class NetworkService extends GObject.Object {
    #network: Network.Network | null = null;
    #wifi: Network.Wifi | null = null;
    #wifiSignalIds: number[] = [];
    #initialized = false;

    static get_default(): NetworkService {
        if (!_instance) _instance = new NetworkService();
        return _instance;
    }

    @getter(Network.Wifi)
    get wifi(): Network.Wifi | null {
        return this.#wifi;
    }

    @getter(String)
    get wifiSsid(): string | null {
        return this.#wifi?.ssid ?? null;
    }

    @getter(Boolean)
    get wifiEnabled(): boolean {
        return this.#wifi?.enabled ?? false;
    }

    @getter(Number)
    get wifiStrength(): number {
        return this.#wifi?.strength ?? 0;
    }

    @getter(Number)
    get wifiState(): number {
        return this.#wifi?.state ?? 0;
    }

    @getter(Boolean)
    get wifiReady(): boolean {
        return this.#wifi !== null && this.#initialized;
    }

    /** Toggle wifi on/off. */
    toggleWifi(): void {
        if (this.#wifi) {
            this.#wifi.enabled = !this.#wifi.enabled;
        }
    }

    /** Initialize the AstalNetwork D-Bus proxy. Call once during boot. */
    init(): void {
        if (this.#initialized) return;
        this.#initialized = true;

        try {
            this.#network = Network.get_default();
        } catch (e) {
            logger.error('networkService', 'Failed to init AstalNetwork:', e);
            return;
        }

        // Listen for wifi device changes (the proxy may be lazy)
        this.#network.connect('notify::wifi', () => {
            this.#onWifiChanged();
        });
        this.#onWifiChanged();
    }

    #onWifiChanged(): void {
        this.#cleanupWifiSignals();
        this.#wifi = this.#network?.wifi ?? null;
        this.notify('wifi');

        const w = this.#wifi;
        if (w) {
            const onPropChanged = () => {
                this.notify('wifi-ssid');
                this.notify('wifi-enabled');
                this.notify('wifi-strength');
                this.notify('wifi-state');
            };

            this.#wifiSignalIds.push(
                w.connect('notify::state', onPropChanged)
            );
            this.#wifiSignalIds.push(
                w.connect('notify::strength', onPropChanged)
            );
            this.#wifiSignalIds.push(
                w.connect('notify::ssid', onPropChanged)
            );
            this.#wifiSignalIds.push(
                w.connect('notify::enabled', onPropChanged)
            );
        }

        this.notify('wifi-ssid');
        this.notify('wifi-enabled');
        this.notify('wifi-strength');
        this.notify('wifi-state');
        this.notify('wifi-ready');
    }

    #cleanupWifiSignals(): void {
        const w = this.#wifi;
        for (const id of this.#wifiSignalIds) {
            try {
                if (w) w.disconnect(id);
            } catch {
                /* already dead */
            }
        }
        this.#wifiSignalIds = [];
    }
}