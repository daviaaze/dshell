import Network from 'gi://AstalNetwork';
import {toArray} from '#/lib/gjsUtils';

// ── NM 802.11 flag constants ──────────────────────────────────────
// NM.__80211ApSecurityFlags is not reliably exposed across GIR versions.
// These are the stable NM values from libnm.

const NM_AP_SEC_KEY_MGMT_PSK = 0x00000100;
const NM_AP_SEC_KEY_MGMT_802_1X = 0x00000200;
const NM_AP_SEC_KEY_MGMT_SAE = 0x00000400;
const NM_AP_SEC_KEY_MGMT_OWE = 0x00000800;
const NM_AP_FLAGS_PRIVACY = 0x00000001;

// ── Byte-string helpers ────────────────────────────────────────────

export function bytesToString(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (value instanceof Uint8Array) {
        let len = value.length;
        for (let i = 0; i < value.length; i++) {
            if (value[i] === 0) {
                len = i;
                break;
            }
        }
        if (len === 0) return '';
        try {
            return new TextDecoder('utf-8', {fatal: false}).decode(
                value.subarray(0, len)
            );
        } catch {
            return null;
        }
    }
    if (typeof value.toString === 'function') {
        const str = value.toString();
        if (str && !str.startsWith('[object ')) return str;
    }
    return null;
}

export function ssidOf(ap: Network.AccessPoint): string {
    try {
        return bytesToString(ap.ssid) ?? 'Hidden Network';
    } catch {
        return 'Hidden Network';
    }
}

export function bssidOf(ap: Network.AccessPoint): string | null {
    try {
        return bytesToString(ap.bssid);
    } catch {
        return null;
    }
}

export function bssidEquals(a: any, b: any): boolean {
    const sa = bytesToString(a);
    const sb = bytesToString(b);
    if (sa === null || sb === null) return false;
    return sa.toLowerCase() === sb.toLowerCase();
}

// ── WiFi icon mapping (Adwaita icon theme) ─────────────────────────

/**
 * Compute the correct WiFi icon name from device state.
 * Does NOT use AstalNetwork's unreliable `iconName` property.
 */
export function wifiIconName(
    strength: number,
    enabled: boolean,
    state: Network.DeviceState
): string {
    if (!enabled) return 'network-wireless-offline-symbolic';

    switch (state) {
        case Network.DeviceState.CONFIG:
        case Network.DeviceState.NEED_AUTH:
        case Network.DeviceState.IP_CONFIG:
        case Network.DeviceState.IP_CHECK:
        case Network.DeviceState.SECONDARIES:
        case Network.DeviceState.PREPARE:
            return 'network-wireless-acquiring-symbolic';
        case Network.DeviceState.ACTIVATED:
            if (strength >= 75)
                return 'network-wireless-signal-excellent-symbolic';
            if (strength >= 50) return 'network-wireless-signal-good-symbolic';
            if (strength >= 25) return 'network-wireless-signal-ok-symbolic';
            return 'network-wireless-signal-weak-symbolic';
        default:
            return 'network-wireless-signal-none-symbolic';
    }
}

// ── Signal strength ────────────────────────────────────────────────

/** Map strength percentage (0-100) to a 0.0-1.0 value for Gtk.LevelBar. */
export function strengthFraction(strength: number): number {
    return Math.max(0, Math.min(1, strength / 100));
}

export function signalIconName(strength: number): string {
    if (strength >= 75) return 'network-wireless-signal-excellent-symbolic';
    if (strength >= 50) return 'network-wireless-signal-good-symbolic';
    if (strength >= 25) return 'network-wireless-signal-ok-symbolic';
    if (strength > 0) return 'network-wireless-signal-weak-symbolic';
    return 'network-wireless-signal-none-symbolic';
}

export function escapeLabel(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ── Security type detection ────────────────────────────────────────

/**
 * Derive a human-readable security label from AP flags.
 * Returns e.g. "WPA3", "WPA2", "WPA1", "WEP", "Enhanced Open", "Open".
 */
export function securityLabel(ap: Network.AccessPoint): string {
    try {
        const rsn = ap.rsnFlags ?? 0;
        const wpa = ap.wpaFlags ?? 0;
        const flags = ap.flags ?? 0;

        // WPA2/WPA3 Transitional: both PSK and SAE
        if (rsn & NM_AP_SEC_KEY_MGMT_PSK && rsn & NM_AP_SEC_KEY_MGMT_SAE) {
            return 'WPA2/WPA3';
        }

        // WPA3: RSN with SAE (Simultaneous Authentication of Equals)
        if (rsn & NM_AP_SEC_KEY_MGMT_SAE) {
            return 'WPA3';
        }

        // Enhanced Open: OWE (Opportunistic Wireless Encryption)
        if (rsn & NM_AP_SEC_KEY_MGMT_OWE) {
            return 'Enhanced Open';
        }

        // WPA2: RSN with PSK or 802.1X
        if (rsn & NM_AP_SEC_KEY_MGMT_PSK || rsn & NM_AP_SEC_KEY_MGMT_802_1X) {
            return 'WPA2';
        }

        // WPA1: WPA flags present with PSK or 802.1X
        if (wpa !== 0) {
            if (
                wpa & NM_AP_SEC_KEY_MGMT_PSK ||
                wpa & NM_AP_SEC_KEY_MGMT_802_1X
            ) {
                return 'WPA1';
            }
            // Some partial WPA support
            return 'WPA';
        }

        // WEP: privacy flag but no WPA/RSN
        if (flags & NM_AP_FLAGS_PRIVACY) {
            return 'WEP';
        }

        // Open network
        return 'Open';
    } catch {
        return 'Unknown';
    }
}

/**
 * Whether the AP uses any encryption (for lock icon display).
 * Uses the same logic as securityLabel but optimized for boolean check.
 */
export function isSecure(ap: Network.AccessPoint): boolean {
    try {
        const rsn = ap.rsnFlags ?? 0;
        const wpa = ap.wpaFlags ?? 0;
        const flags = ap.flags ?? 0;
        return rsn !== 0 || wpa !== 0 || (flags & NM_AP_FLAGS_PRIVACY) !== 0;
    } catch {
        return false;
    }
}

// ── Saved / known network detection ────────────────────────────────

/**
 * Check if an AP has any saved (known) NM connections.
 */
export function isSaved(ap: Network.AccessPoint): boolean {
    try {
        const conns = ap.get_connections();
        if (!conns) return false;
        // GLib.List check
        let count = 0;
        let l: any = conns;
        while (l) {
            count++;
            l = l.next;
        }
        return count > 0;
    } catch {
        return false;
    }
}

// ── AP Snapshot (defensive copy for render) ───────────────────────

export interface ApSnapshot {
    ssid: string;
    bssid: string | null;
    strength: number;
    secure: boolean;
    secLabel: string;
}

/**
 * Eagerly read all GObject properties into a plain-JS snapshot.
 * Call this immediately when accessPoints changes, while the proxy is still valid.
 */
export function snapshotAp(ap: Network.AccessPoint): ApSnapshot {
    return {
        ssid: ssidOf(ap),
        bssid: bssidOf(ap),
        strength: (() => {
            try {
                return ap.strength ?? 0;
            } catch {
                return 0;
            }
        })(),
        secure: isSecure(ap),
        secLabel: securityLabel(ap),
    };
}

/**
 * Look up a current (live) AP object from wifi.accessPoints.
 * Priority: exact BSSID match → SSID match.
 * SSID fallback handles cases where BSSID is null (bytesToString failure)
 * or the AP was rescanned with a different BSSID between render and action.
 * Only use this for actions (connect/forget), never for rendering.
 */
export function findLiveAp(
    wifi: Network.Wifi,
    bssid: string | null,
    ssid?: string
): Network.AccessPoint | null {
    const points = (() => {
        try {
            return toArray<Network.AccessPoint>(wifi.accessPoints);
        } catch {
            return [];
        }
    })();

    // 1. Try BSSID match (most precise)
    if (bssid) {
        for (const ap of points) {
            try {
                const apBssid = bssidOf(ap);
                if (apBssid && bssidEquals(apBssid, bssid)) return ap;
            } catch {
                continue;
            }
        }
    }

    // 2. Fallback: SSID match (handles null BSSID or rescanned APs)
    if (ssid) {
        for (const ap of points) {
            try {
                const apSsid = ssidOf(ap);
                if (apSsid === ssid) return ap;
            } catch {
                continue;
            }
        }
    }

    return null;
}

// ── Shared NM connection builder ───────────────────────────────────

/** Build a NM.SimpleConnection for a WiFi network. Reused by apList and settings/network. */
export function createNMConnection(
    ssid: string,
    password?: string,
    hidden = false
): NM.SimpleConnection {
    const connection = new NM.SimpleConnection();

    const sCon = new NM.SettingConnection();
    sCon.type = '802-11-wireless';
    sCon.uuid = GLib.uuid_string_random() ?? undefined;
    sCon.id = ssid;
    connection.add_setting(sCon);

    const sWifi = new NM.SettingWireless();
    sWifi.ssid = new GLib.Bytes(new TextEncoder().encode(ssid)) as any;
    sWifi.mode = 'infrastructure';
    sWifi.hidden = hidden;
    connection.add_setting(sWifi);

    if (password) {
        const sSec = new NM.SettingWirelessSecurity();
        sSec.key_mgmt = 'wpa-psk';
        sSec.psk = password;
        connection.add_setting(sSec);
    }

    return connection;
}

/** Convert NM key management string to a human-readable security label. */
export function securityLabelFromKeyMgmt(keyMgmt: string | null): string {
    if (!keyMgmt) return 'Open';
    switch (keyMgmt) {
        case 'sae':
            return 'WPA3';
        case 'wpa-psk':
            return 'WPA2';
        case 'wpa-eap':
        case 'ieee8021x':
            return 'Enterprise';
        case 'none':
            return 'WEP';
        default:
            return keyMgmt || 'Secure';
    }
}

/** Async wrapper for NM.RemoteConnection.commit_changes_async. */
export function commitChangesAsync(
    conn: NM.RemoteConnection,
    saveToDisk: boolean
): Promise<void> {
    return new Promise((resolve, reject) => {
        conn.commit_changes_async(
            saveToDisk,
            null,
            (_source: any, res: any) => {
                try {
                    conn.commit_changes_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

/** Async wrapper for NM.RemoteConnection.delete_async. */
export function deleteConnectionAsync(
    conn: NM.RemoteConnection
): Promise<void> {
    return new Promise((resolve, reject) => {
        conn.delete_async(null, (_source: any, res: any) => {
            try {
                conn.delete_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}
