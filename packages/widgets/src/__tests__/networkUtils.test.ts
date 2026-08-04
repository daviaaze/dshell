/**
 * Tests for network utility functions — pure logic, no GObject deps.
 *
 * Run: gjs -m src/lib/__tests__/networkUtils.test.ts
 */

import AstalNetwork from 'gi://AstalNetwork';
import {
    securityLabelFromKeyMgmt,
    signalIconName,
    strengthFraction,
    wifiIconName,
} from '@shade/widgets/quicksettings/network/utils';
import {describe, expect, it, run} from './test-runner';

describe('securityLabelFromKeyMgmt', () => {
    it('returns WPA3 for sae', () => {
        expect(securityLabelFromKeyMgmt('sae')).toBe('WPA3');
    });

    it('returns WPA2 for wpa-psk', () => {
        expect(securityLabelFromKeyMgmt('wpa-psk')).toBe('WPA2');
    });

    it('returns Enterprise for wpa-eap and ieee8021x', () => {
        expect(securityLabelFromKeyMgmt('wpa-eap')).toBe('Enterprise');
        expect(securityLabelFromKeyMgmt('ieee8021x')).toBe('Enterprise');
    });

    it('returns WEP for none', () => {
        expect(securityLabelFromKeyMgmt('none')).toBe('WEP');
    });

    it('returns Open for null', () => {
        expect(securityLabelFromKeyMgmt(null)).toBe('Open');
    });

    it('falls back to the keyMgmt string for unknown values', () => {
        expect(securityLabelFromKeyMgmt('some-future-auth')).toBe('some-future-auth');
    });
});

describe('wifiIconName', () => {
    it('returns offline icon when disabled', () => {
        const name = wifiIconName(100, false, AstalNetwork.DeviceState.ACTIVATED);
        expect(name).toBe('network-wireless-offline-symbolic');
    });

    it('returns acquiring icon for config/need-auth states', () => {
        expect(wifiIconName(100, true, AstalNetwork.DeviceState.CONFIG)).toBe(
            'network-wireless-acquiring-symbolic'
        );
        expect(wifiIconName(100, true, AstalNetwork.DeviceState.NEED_AUTH)).toBe(
            'network-wireless-acquiring-symbolic'
        );
    });

    it('returns excellent icon for strength >= 75 when activated', () => {
        expect(wifiIconName(75, true, AstalNetwork.DeviceState.ACTIVATED)).toBe(
            'network-wireless-signal-excellent-symbolic'
        );
    });

    it('returns good icon for strength >= 50', () => {
        expect(wifiIconName(50, true, AstalNetwork.DeviceState.ACTIVATED)).toBe(
            'network-wireless-signal-good-symbolic'
        );
    });

    it('returns ok icon for strength >= 25', () => {
        expect(wifiIconName(25, true, AstalNetwork.DeviceState.ACTIVATED)).toBe(
            'network-wireless-signal-ok-symbolic'
        );
    });

    it('returns weak icon for strength > 0 but < 25', () => {
        expect(wifiIconName(10, true, AstalNetwork.DeviceState.ACTIVATED)).toBe(
            'network-wireless-signal-weak-symbolic'
        );
    });

    it('returns none icon for other states', () => {
        expect(wifiIconName(100, true, AstalNetwork.DeviceState.DISCONNECTED)).toBe(
            'network-wireless-signal-none-symbolic'
        );
    });
});

describe('strengthFraction', () => {
    it('converts 100 to 1.0', () => expect(strengthFraction(100)).toBe(1));
    it('converts 50 to 0.5', () => expect(strengthFraction(50)).toBe(0.5));
    it('converts 0 to 0.0', () => expect(strengthFraction(0)).toBe(0));
    it('clamps negative values to 0', () => expect(strengthFraction(-10)).toBe(0));
    it('clamps >100 values to 1', () => expect(strengthFraction(150)).toBe(1));
});

describe('signalIconName', () => {
    it('returns excellent for >= 75', () => {
        expect(signalIconName(75)).toBe('network-wireless-signal-excellent-symbolic');
    });
    it('returns good for >= 50', () => {
        expect(signalIconName(50)).toBe('network-wireless-signal-good-symbolic');
    });
    it('returns ok for >= 25', () => {
        expect(signalIconName(25)).toBe('network-wireless-signal-ok-symbolic');
    });
    it('returns weak for > 0', () => {
        expect(signalIconName(1)).toBe('network-wireless-signal-weak-symbolic');
    });
    it('returns none for 0', () => {
        expect(signalIconName(0)).toBe('network-wireless-signal-none-symbolic');
    });
});

await run();
