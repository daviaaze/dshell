import type NM from 'gi://NM?version=1.0';
import {
    HIDDEN_NETWORK_LABEL,
    OPEN_NETWORK_LABEL,
    securityLabel,
    snapshotNMAccessPoint,
    ssidOf,
} from '../network/utils';
import {describe, expect, it, run} from '../../__tests__/test-runner';

function accessPoint(ssid: string | null, rsnFlags = 0, flags = 0): NM.AccessPoint {
    return {
        ssid,
        rsnFlags,
        wpaFlags: 0,
        flags,
        bssid: '00:11:22:33:44:55',
        strength: 75,
        get_path: () => '/org/freedesktop/NetworkManager/AccessPoint/1',
    } as unknown as NM.AccessPoint;
}

describe('Quick Settings network labels', () => {
    it('uses Portuguese copy for missing and empty SSIDs', () => {
        expect(ssidOf(accessPoint(null))).toBe(HIDDEN_NETWORK_LABEL);
        expect(ssidOf(accessPoint(''))).toBe(HIDDEN_NETWORK_LABEL);
        expect(HIDDEN_NETWORK_LABEL).toBe('Rede oculta');
    });

    it('preserves real SSIDs that resemble hidden-network labels', () => {
        expect(ssidOf(accessPoint('Hidden Network'))).toBe('Hidden Network');
        expect(ssidOf(accessPoint('Rede oculta'))).toBe('Rede oculta');
    });

    it('uses the same open-network caption for access-point and saved-network rows', () => {
        expect(securityLabel(accessPoint('Shade-Test'))).toBe(OPEN_NETWORK_LABEL);
        expect(OPEN_NETWORK_LABEL).toBe('Aberta');
    });

    it('keeps security protocol identifiers while translating descriptive captions', () => {
        expect(securityLabel(accessPoint('Shade-Test', 0x800))).toBe('Aberta (OWE)');
        expect(securityLabel(accessPoint('Shade-Test', 0x400))).toBe('WPA3');
        expect(securityLabel(accessPoint('Shade-Test', 0x100))).toBe('WPA2');
        expect(securityLabel(accessPoint('Shade-Test', 0, 1))).toBe('WEP');
    });

    it('copies the AP identity and localized display data without changing the source', () => {
        const ap = accessPoint(null);
        expect(snapshotNMAccessPoint(ap)).toEqual({
            objectPath: '/org/freedesktop/NetworkManager/AccessPoint/1',
            ssid: 'Rede oculta',
            bssid: '00:11:22:33:44:55',
            strength: 75,
            secure: false,
            secLabel: 'Aberta',
        });
        expect(ap.ssid).toBe(null);
    });
});

await run();
