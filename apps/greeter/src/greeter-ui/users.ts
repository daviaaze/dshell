// AccountsService GIR import — requires accountsservice package installed at runtime.
import GLib from 'gi://GLib?version=2.0';

import Act from 'gi://AccountsService?version=1.0';

export interface GreeterUser {
    username: string;
    realName: string;
    iconFile: string | null;
    uid: number;
}

let cachedUsers: GreeterUser[] | null = null;

export function getGreeterUsers(): GreeterUser[] {
    if (cachedUsers !== null) return cachedUsers;

    try {
        const manager = Act.UserManager.get_default();
        const users = manager.list_users();
        const result: GreeterUser[] = [];
        for (const user of users) {
            if (user.is_system_account()) continue;
            const uid = user.get_uid();
            if (uid < 1000) continue;
            const username = user.get_user_name();
            if (username === 'greeter' || username === 'nobody') continue;
            result.push({
                username,
                realName: user.get_real_name() || username,
                iconFile: user.get_icon_file(),
                uid,
            });
        }
        cachedUsers = result;
        return result;
    } catch {
        return [];
    }
}

export function getLastUsername(): string | null {
    try {
        const [ok, content] = GLib.file_get_contents('/var/cache/shade-greeter/last-user');
        if (ok && content instanceof Uint8Array) {
            const str = new TextDecoder().decode(content).trim();
            return str || null;
        }
        return null;
    } catch {
        return null;
    }
}

export function setLastUsername(username: string): void {
    try {
        const bytes = new TextEncoder().encode(username);
        GLib.file_set_contents('/var/cache/shade-greeter/last-user', bytes);
    } catch {
        // silent
    }
}
