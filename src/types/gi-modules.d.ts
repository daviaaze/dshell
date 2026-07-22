// ── Astal4 ────────────────────────────────────────────────────

declare module 'gi://Astal?version=4.0' {
    import type GObject from 'gi://GObject';
    import type Gtk from 'gi://Gtk?version=4.0';
    namespace Astal4 {
        enum WindowAnchor {
            TOP = 1,
            BOTTOM = 2,
            LEFT = 4,
            RIGHT = 8,
        }
        enum Layer {
            BACKGROUND = -2,
            BOTTOM = -1,
            NORMAL = 0,
            TOP = 1,
            OVERLAY = 2,
        }
        // eslint-disable-next-line @typescript-eslint/no-empty-interface
        interface WindowProps extends Gtk.Window.ConstructorProperties {
            anchor?: number;
            layer?: number;
            exclusivity?: number;
            monitor?: number;
            namespace?: string;
        }
        class Window extends Gtk.Window {
            constructor(props?: WindowProps);
            anchor: number;
            layer: number;
            exclusivity: number;
            monitor: number;
            namespace: string;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default Astal4;
}

// ── AstalApps ──────────────────────────────────────────────────

declare module 'gi://AstalApps' {
    namespace AstalApps {
        class Apps extends GObject.Object {
            constructor();
            list: never[];
            exact_query: (query: string) => never[];
            fuzzy_query: (query: string) => never[];
            reload(): void;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalApps;
}

// ── AstalAuth ──────────────────────────────────────────────────

declare module 'gi://AstalAuth' {
    namespace AstalAuth {
        class Auth extends GObject.Object {
            static get_default(): Auth;
            authenticate(password: string): boolean;
            is_authenticated: boolean;
            num_failed_attempts: number;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalAuth;
}

// ── AstalBattery ───────────────────────────────────────────────

declare module 'gi://AstalBattery' {
    import type GObject from 'gi://GObject';
    namespace AstalBattery {
        class Battery extends GObject.Object {
            static get_default(): Battery;
            percentage: number;
            charging: boolean;
            charged: boolean;
            state: number;
            time_to_full: number;
            time_to_empty: number;
            energy: number;
            energy_full: number;
            energy_rate: number;
            icon_name: string;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalBattery;
}

// ── AstalBluetooth ─────────────────────────────────────────────

declare module 'gi://AstalBluetooth' {
    import type GObject from 'gi://GObject';
    namespace AstalBluetooth {
        class Device extends GObject.Object {
            address: string;
            alias: string;
            battery_percentage: number;
            connected: boolean;
            connect(): void;
            disconnect(): void;
            icon: string;
            name: string;
            paired: boolean;
            trusted: boolean;
        }
        class Bluetooth extends GObject.Object {
            static get_default(): Bluetooth;
            devices: Device[];
            adapter: string;
            is_powered: boolean;
            is_connected: boolean;
            is_discovering: boolean;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalBluetooth;
}

// ── AstalBrightness ────────────────────────────────────────────

declare module 'gi://AstalBrightness' {
    import type GObject from 'gi://GObject';
    namespace AstalBrightness {
        /** A brightness device proxy (backlight or leds subsystem). */
        class DeviceProxy extends GObject.Object {
            brightness: number;
            max_brightness: number;
            name: string;
            subsystem: string;
        }
        class Brightness extends GObject.Object {
            static get_default(): Brightness;
            screen: DeviceProxy;
            kbd: DeviceProxy;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalBrightness;
}

// ── AstalGreet ─────────────────────────────────────────────────

declare module 'gi://AstalGreet' {
    namespace Greet {
        class Greeter {
            static get_default(): Greeter;
            create_session(username: string): void;
            post_auth(response: string): void;
            start_session_finish(res: unknown): void;
            is_authenticated: boolean;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default Greet;
}

// ── AstalCava ─────────────────────────────────────────────────

declare module 'gi://AstalCava' {
    import type GObject from 'gi://GObject';
    namespace AstalCava {
        class Cava extends GObject.Object {
            bars: number;
            framerate: number;
            active: boolean;
            get_values(): number[];
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalCava;
}

// ── AstalHyprland ──────────────────────────────────────────────

declare module 'gi://AstalHyprland' {
    import type GObject from 'gi://GObject';
    namespace AstalHyprland {
        class Workspace extends GObject.Object {
            id: number;
            name: string;
            monitor: string;
            windows: number;
            focused: boolean;
            urgent: boolean;
        }
        class Monitor extends GObject.Object {
            id: number;
            name: string;
            model: string;
            width: number;
            height: number;
            scale: number;
            focused: boolean;
            workspace: Workspace;
        }
        class Hyprland extends GObject.Object {
            static get_default(): Hyprland;
            focused_monitor: Monitor;
            focused_workspace: Workspace;
            workspaces: Workspace[];
            monitors: Monitor[];
            message: (command: string) => string;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalHyprland;
}

// ── AstalMpris ─────────────────────────────────────────────────

declare module 'gi://AstalMpris' {
    import type GObject from 'gi://GObject';
    namespace AstalMpris {
        class Player extends GObject.Object {
            bus_name: string;
            entry: string;
            identity: string;
            artist: string;
            title: string;
            cover_art: string;
            playback_status: number;
            position: number;
            length: number;
            volume: number;
            can_go_next: boolean;
            can_go_prev: boolean;
            can_play: boolean;
            can_seek: boolean;
            can_control: boolean;
            loop_status: number;
            shuffle: boolean;
            play(): void;
            pause(): void;
            play_pause(): void;
            next(): void;
            previous(): void;
            seek(offset: number): void;
        }
        class Mpris extends GObject.Object {
            static get_default(): Mpris;
            players: Player[];
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalMpris;
}

// ── AstalNetwork ───────────────────────────────────────────────

declare module 'gi://AstalNetwork' {
    import type GObject from 'gi://GObject';
    namespace AstalNetwork {
        class AccessPoint extends GObject.Object {
            bssid: string;
            ssid: string;
            strength: number;
            frequency: number;
            flags: number;
            last_seen: number;
        }
        class Wired extends GObject.Object {
            device: string;
            ipv4: object;
            ipv6: object;
            internet: number;
            speed: number;
        }
        class Wifi extends GObject.Object {
            ssid: string;
            strength: number;
            frequency: number;
            internet: number;
            access_points: AccessPoint[];
        }
        class Network extends GObject.Object {
            static get_default(): Network;
            wifi: Wifi;
            wired: Wired;
            primary: string;
            connectivity: number;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalNetwork;
}

// ── AstalNotifd ────────────────────────────────────────────────

declare module 'gi://AstalNotifd' {
    import type GObject from 'gi://GObject';
    namespace AstalNotifd {
        type Urgency = 0 | 1 | 2;
        type CloseReason = 1 | 2 | 3 | 4 | 5;
        class Notification extends GObject.Object {
            id: number;
            app_name: string;
            app_icon: string;
            image: string;
            summary: string;
            body: string;
            urgency: Urgency;
            time: number;
            category: string;
            desktop_entry: string;
            actions: string[];
            dismiss(): void;
            invoke_action(action: string): void;
        }
        class Notifd extends GObject.Object {
            static get_default(): Notifd;
            notifications: Notification[];
            notiified: number;
            closed: number;
            dont_disturb: boolean;
            send_notification(summary: string, body: string, icon: string, urgency: number): number;
            dismiss_all(): void;
            connect_notification(
                name: string,
                callback: (notifd: Notifd, id: number) => void
            ): number;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalNotifd;
}

// ── AstalPowerProfiles ─────────────────────────────────────────

declare module 'gi://AstalPowerProfiles' {
    import type GObject from 'gi://GObject';
    namespace AstalPowerProfiles {
        class PowerProfiles extends GObject.Object {
            static get_default(): PowerProfiles;
            active_profile: 'power-saver' | 'balanced' | 'performance';
            performance_inhibited: string;
            profiles: {profile: string; driver: string}[];
            icon_name: string;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalPowerProfiles;
}

// ── AstalWl ────────────────────────────────────────────────────

declare module 'gi://AstalWl' {
    namespace AstalWl {
        function get_language(): string;
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalWl;
}

// ── AstalWireplumber ─────────────────────────────────────────

declare module 'gi://AstalWireplumber' {
    import type GObject from 'gi://GObject';
    namespace AstalWireplumber {
        class Audio extends GObject.Object {
            static get_default(): Audio;
        }
        class Endpoint extends GObject.Object {
            name: string;
            description: string;
            volume: number;
            mute: boolean;
            icon: string;
            default: boolean;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalWireplumber;
}
