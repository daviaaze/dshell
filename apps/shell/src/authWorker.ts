import AstalAuth from 'gi://AstalAuth?version=0.1';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

function readPassword(): string | null {
    try {
        const stream = Gio.DataInputStream.new(
            Gio.File.new_for_path('/dev/stdin').read(null)
        );
        try {
            const [line] = stream.read_line_utf8(null);
            if (line === null) return null;
            const input = JSON.parse(line) as {password?: unknown};
            return typeof input.password === 'string' ? input.password : null;
        } finally {
            stream.close(null);
        }
    } catch {
        return null;
    }
}

const password = readPassword();
if (password === null) {
    print('failure');
} else {
    const pam = new AstalAuth.Pam();
    const loop = GLib.MainLoop.new(null, false);
    let completed = false;
    let result = 'failure';

    const finish = (authenticated: boolean) => {
        if (completed) return;
        completed = true;
        result = authenticated ? 'success' : 'failure';
        loop.quit();
    };

    pam.connect('auth-prompt-hidden', () => pam.supply_secret(password));
    pam.connect('auth-prompt-visible', () => pam.supply_secret(null));
    pam.connect('auth-info', () => pam.supply_secret(null));
    pam.connect('auth-error', () => pam.supply_secret(null));
    pam.connect('success', () => finish(true));
    pam.connect('fail', () => finish(false));

    try {
        if (!pam.start_authenticate()) finish(false);
        if (!completed) loop.run();
    } catch {
        finish(false);
    }

    print(result);
}
