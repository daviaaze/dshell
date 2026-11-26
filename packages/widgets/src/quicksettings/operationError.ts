/** A local Wi-Fi failure whose message is already safe, actionable pt-BR copy. */
export class WifiOperationError extends Error {}

function messageOf(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return String(error);
}

export function wifiErrorMessage(error: unknown): string {
    if (error instanceof WifiOperationError) return error.message;
    const message = messageOf(error);
    if (/no.?secrets|password|authentication|login.?failed/i.test(message))
        return 'Verifique a senha da rede Wi-Fi e tente novamente.';
    if (/not.?authorized|permission|access.?denied/i.test(message))
        return 'Você não tem permissão para alterar esta conexão Wi-Fi.';
    if (/timed?.?out|timeout/i.test(message))
        return 'A conexão Wi-Fi demorou demais. Tente novamente.';
    if (/unavailable|not.?available|unknown.?device|not.?found/i.test(message))
        return 'A rede ou o adaptador Wi-Fi não está mais disponível. Busque redes novamente.';
    return 'Não foi possível concluir a operação Wi-Fi. Tente novamente.';
}

export function bluetoothErrorMessage(
    error: unknown,
    fallback = 'Não foi possível alterar a conexão Bluetooth. Tente novamente.'
): string {
    const message = messageOf(error);
    if (/authentication|authenticationcanceled|rejected/i.test(message))
        return 'Não foi possível autenticar o dispositivo Bluetooth. Tente parear novamente.';
    if (/not.?ready|not.?powered/i.test(message))
        return 'Ative o Bluetooth antes de conectar um dispositivo.';
    if (/in.?progress|already.?in.?progress/i.test(message))
        return 'Outra operação Bluetooth está em andamento. Aguarde e tente novamente.';
    if (/not.?authorized|permission|access.?denied/i.test(message))
        return 'Você não tem permissão para alterar esta conexão Bluetooth.';
    if (/not.?supported/i.test(message)) return 'Este dispositivo não oferece suporte a esta ação.';
    if (/timed?.?out|timeout|no.?reply|host.?is.?down|connection.?attempt.?failed/i.test(message))
        return 'O dispositivo Bluetooth não respondeu. Aproxime-o e tente novamente.';
    return fallback;
}
