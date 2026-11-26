import type AstalNetwork from 'gi://AstalNetwork?version=0.1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import {bus} from '@shade/services/bus';
import NetworkService from '@shade/services/network/networkService';
import {bind, computed, createState, type GnimNode, onCleanup, With} from 'gnim';
import {QuickControlButton} from '../../common/quickControlButton';
import {wifiErrorMessage} from '../operationError';
import {wifiIconName} from './utils';
import WifiDetails from './wifiDetails';

const RADIO_SETTLE_MS = 3000;

export default (onOpen: (self: Gtk.Button) => void): {widget: GnimNode; detail: GnimNode} => {
    const net = NetworkService.get_default();
    const [connectingAp, setConnectingAp] = createState<string | null>(null);

    const wifi = bind(net, 'wifi');
    const ready = bind(net, 'wifiReady');
    const wifiSsid = bind(net, 'wifiSsid');
    const wifiEnabled = bind(net, 'wifiEnabled');
    const wifiState = bind(net, 'wifiState');
    const wifiStrength = bind(net, 'wifiStrength');
    const [radioTarget, setRadioTarget] = createState<boolean | null>(null);
    const [operationError, setOperationError] = createState<string | null>(null);
    const radioPending = radioTarget.as((target) => target !== null);
    const radioActive = computed(() => radioTarget() ?? wifiEnabled());
    let settleSource = 0;
    const cancelSettle = () => {
        if (settleSource) GLib.source_remove(settleSource);
        settleSource = 0;
    };
    const finishRadio = (error?: string) => {
        cancelSettle();
        setRadioTarget(null);
        if (error) setOperationError(error);
    };
    const setRadioEnabled = (enabled: boolean) => {
        if (!wifi.peek() || radioPending.peek() || enabled === wifiEnabled.peek()) return;
        setOperationError(null);
        setRadioTarget(enabled);
        settleSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RADIO_SETTLE_MS, () => {
            settleSource = 0;
            finishRadio('Não foi possível alterar o estado do Wi-Fi. Tente novamente.');
            return GLib.SOURCE_REMOVE;
        });
        try {
            bus.emit('network:wifi:toggle');
        } catch (error) {
            logger.warn('network', 'Wi-Fi radio change failed:', error);
            finishRadio(wifiErrorMessage(error));
        }
    };
    onCleanup(
        wifiEnabled.subscribe(() => {
            if (wifiEnabled.peek() === radioTarget.peek()) finishRadio();
        })
    );
    onCleanup(
        wifi.subscribe(() => {
            if (!wifi.peek()) finishRadio();
        })
    );
    onCleanup(cancelSettle);

    const icon = computed(() => {
        if (connectingAp()) return 'content-loading-symbolic';
        if (!wifiEnabled()) return 'network-wireless-offline-symbolic';
        return wifiIconName(wifiStrength(), true, wifiState());
    });

    const value = computed(() => {
        if (!wifi()) return ready() ? 'Indisponível' : 'Carregando…';
        if (radioPending()) return radioTarget() ? 'Ativando…' : 'Desativando…';
        if (!wifiEnabled()) return 'Desativado';
        if (connectingAp()) return 'Conectando…';
        if (wifiState() !== 100) return 'Não conectado';
        const ssid = wifiSsid()?.trim();
        return ssid && ssid !== '...' ? ssid : 'Conectado';
    });

    const detail = (
        <With value={wifi}>
            {(device: AstalNetwork.Wifi | null) =>
                device ? (
                    <WifiDetails
                        wifi={device}
                        connectingAp={connectingAp}
                        setConnectingAp={setConnectingAp}
                        status={value}
                        radioActive={radioActive}
                        radioPending={radioPending}
                        operationError={operationError}
                        onSetEnabled={setRadioEnabled}
                        onScan={() => {
                            setOperationError(null);
                            try {
                                device.scan();
                            } catch (error) {
                                logger.warn('network', 'Wi-Fi scan failed:', error);
                                setOperationError(
                                    'Não foi possível buscar redes Wi-Fi. Tente novamente.'
                                );
                            }
                        }}
                    />
                ) : (
                    <Gtk.Label
                        label={ready.as((value) =>
                            value ? 'Nenhum adaptador Wi-Fi disponível.' : 'Carregando Wi-Fi…'
                        )}
                        wrap
                    />
                )
            }
        </With>
    );

    return {
        widget: (
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                <QuickControlButton
                    intent="toggle"
                    domain="Wi-Fi"
                    icon={icon}
                    value={value}
                    active={radioActive}
                    visible={bind(net, 'wifiAvailable')}
                    actionLabel={wifiEnabled.as((enabled) =>
                        enabled ? 'Desativar Wi-Fi' : 'Ativar Wi-Fi'
                    )}
                    onClick={() => setRadioEnabled(!radioActive.peek())}
                    actionSensitive={computed(() => wifi() !== null && !radioPending())}
                    // This accessible name is an exact VM workflow selector.
                    detail={{label: 'Wi-Fi details', onOpen}}
                />
                <Gtk.Label
                    label={operationError.as((message) => message ?? '')}
                    visible={operationError.as(Boolean)}
                    cssClasses={['error', 'caption']}
                    xalign={0}
                    wrap
                />
            </Gtk.Box>
        ),
        detail,
    };
};
