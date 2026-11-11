export type LuaValue = string | number | boolean | null | LuaValue[] | {[key: string]: LuaValue};
export type BindAction =
    | {
          type: 'hypr-dispatch';
          name:
              | 'close'
              | 'pseudo'
              | 'fullscreen'
              | 'toggle-float'
              | 'focus'
              | 'move'
              | 'layout'
              | 'group-toggle'
              | 'group-next'
              | 'group-lock'
              | 'toggle-special-workspace'
              | 'resize'
              | 'drag'
              | 'exact-pseudo';
          args?: LuaValue;
      }
    | {type: 'shell-action'; name: string; command: string}
    | {type: 'launch-app'; desktopId: string}
    | {type: 'command'; command: string};

export interface BindSpec {
    id: string;
    keys: string;
    title: string;
    category: string;
    action: BindAction;
    flags?: {
        locked?: boolean;
        repeating?: boolean;
        release?: boolean;
        mouse?: boolean;
        nonConsuming?: boolean;
    };
}

export interface WindowRuleSpec {
    id: string;
    match: Record<string, LuaValue>;
    effects: Record<string, LuaValue>;
    enabled?: boolean;
}

export interface LayerRuleSpec {
    match: Record<string, LuaValue>;
    effects: Record<string, LuaValue>;
    enabled?: boolean;
}

export interface StartupSpec {
    id: string;
    desktopId?: string;
    command?: string;
    enabled: boolean;
    phase?: 'load' | 'start';
}

export interface MonitorProfile {
    monitors: Array<{
        name: string;
        description?: string;
        resolution: string;
        position: string;
        scale: number;
        transform: number;
        vrr: number | null;
        disabled: boolean;
        mirror?: string | null;
        bitdepth?: 8 | 10 | null;
        cm?: string | null;
        sdrbrightness?: number | null;
        sdrsaturation?: number | null;
    }>;
    workspaces: Record<string, string>;
    auto?: boolean;
}

export interface CompositorSeed {
    version: 1;
    settings: Record<string, LuaValue>;
    input: Record<string, LuaValue>;
    binds: BindSpec[];
    monitorRules: LuaValue[];
    workspaceRules: LuaValue[];
    windowRules: WindowRuleSpec[];
    layerRules: LayerRuleSpec[];
    gestures: LuaValue[];
    curves: LuaValue[];
    animations: LuaValue[];
    startup: Array<StartupSpec & {phase: 'load' | 'start'}>;
    devices: LuaValue[];
    plugins: string[];
    layouts: {current: string | null; layouts: Record<string, MonitorProfile>};
    extraLuaConfig: string;
}

export interface BindOverride extends Partial<BindSpec> {
    disabled?: boolean;
}

export interface UserConfig {
    version: 1;
    settings?: Record<string, LuaValue>;
    input?: Record<string, LuaValue>;
    binds?: Record<string, BindOverride>;
    monitorRules?: LuaValue[];
    workspaceRules?: LuaValue[];
    windowRules?: Record<string, Partial<WindowRuleSpec> & {disabled?: boolean}>;
    layerRules?: LayerRuleSpec[];
    gestures?: LuaValue[];
    curves?: LuaValue[];
    animations?: LuaValue[];
    startup?: Record<string, Partial<StartupSpec> & {disabled?: boolean; phase?: 'load' | 'start'}>;
    devices?: LuaValue[];
    plugins?: string[];
    layouts?: {current?: string | null; layouts?: Record<string, MonitorProfile | null>};
}

export interface ConfigValidationError {
    path: string;
    message: string;
}
