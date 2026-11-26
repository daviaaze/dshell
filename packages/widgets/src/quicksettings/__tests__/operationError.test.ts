import {describe, expect, it, run} from '../../__tests__/test-runner';
import {bluetoothErrorMessage, WifiOperationError, wifiErrorMessage} from '../operationError';

describe('Quick Settings operation errors', () => {
    it('retains actionable local Wi-Fi validation messages', () => {
        expect(wifiErrorMessage(new WifiOperationError('Use “Conectar à rede oculta”.'))).toBe(
            'Use “Conectar à rede oculta”.'
        );
    });

    it('translates known NetworkManager authentication and permission failures', () => {
        expect(wifiErrorMessage(new Error('No secrets were provided'))).toBe(
            'Verifique a senha da rede Wi-Fi e tente novamente.'
        );
        expect(wifiErrorMessage(new Error('Not authorized to control networking'))).toBe(
            'Você não tem permissão para alterar esta conexão Wi-Fi.'
        );
    });

    it('translates Wi-Fi timeouts without exposing raw library text', () => {
        expect(wifiErrorMessage(new Error('Connection activation timed out'))).toBe(
            'A conexão Wi-Fi demorou demais. Tente novamente.'
        );
        expect(wifiErrorMessage(new Error('Unknown backend failure: private detail'))).toBe(
            'Não foi possível concluir a operação Wi-Fi. Tente novamente.'
        );
    });

    it('translates known BlueZ failures', () => {
        expect(bluetoothErrorMessage(new Error('org.bluez.Error.AuthenticationFailed'))).toBe(
            'Não foi possível autenticar o dispositivo Bluetooth. Tente parear novamente.'
        );
        expect(bluetoothErrorMessage(new Error('org.bluez.Error.NotReady'))).toBe(
            'Ative o Bluetooth antes de conectar um dispositivo.'
        );
        expect(bluetoothErrorMessage(new Error('org.bluez.Error.InProgress'))).toBe(
            'Outra operação Bluetooth está em andamento. Aguarde e tente novamente.'
        );
    });

    it('uses an action-specific fallback for unknown Bluetooth errors', () => {
        expect(bluetoothErrorMessage(new Error('raw backend detail'), 'Falha ao buscar.')).toBe(
            'Falha ao buscar.'
        );
    });
});

await run();
