import type {
    BindAction,
    BindSpec,
    CompositorSeed,
    ConfigValidationError,
    LayerRuleSpec,
    LuaValue,
    MonitorProfile,
    UserConfig,
} from './types';

export type {
    BindAction,
    BindSpec,
    CompositorSeed,
    LayerRuleSpec,
    LuaValue,
    MonitorProfile,
    UserConfig,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

function mergeRecord<T extends Record<string, unknown>>(
    base: T,
    override: Record<string, unknown>
): T {
    const result: Record<string, unknown> = {...base};
    for (const [key, value] of Object.entries(override)) {
        if (isRecord(value) && isRecord(result[key]))
            result[key] = mergeRecord(result[key] as Record<string, unknown>, value);
        else result[key] = value;
    }
    return result as T;
}

function mergeEntries<T extends {id: string}>(
    defaults: T[],
    overrides: Record<string, Partial<T> & {disabled?: boolean}> | undefined
): T[] {
    const result = new Map(defaults.map((entry) => [entry.id, entry]));
    for (const [id, override] of Object.entries(overrides ?? {})) {
        if (override.disabled) {
            result.delete(id);
            continue;
        }
        const current = result.get(id);
        const merged = {...current, ...override, id} as T;
        delete (merged as T & {disabled?: boolean}).disabled;
        result.set(id, merged);
    }
    return [...result.values()];
}

export function mergeCompositorConfig(seed: CompositorSeed, user: UserConfig): CompositorSeed {
    const layouts = {...seed.layouts.layouts};
    for (const [id, profile] of Object.entries(user.layouts?.layouts ?? {})) {
        if (profile === null) delete layouts[id];
        else layouts[id] = profile;
    }
    const current =
        user.layouts?.current === undefined ? seed.layouts.current : user.layouts.current;
    return {
        ...seed,
        settings: mergeRecord(seed.settings, user.settings ?? {}),
        input: mergeRecord(seed.input, user.input ?? {}),
        binds: mergeEntries(seed.binds, user.binds),
        monitorRules: user.monitorRules ?? seed.monitorRules,
        workspaceRules: user.workspaceRules ?? seed.workspaceRules,
        windowRules: mergeEntries(seed.windowRules, user.windowRules),
        layerRules: user.layerRules ?? seed.layerRules,
        gestures: user.gestures ?? seed.gestures,
        curves: user.curves ?? seed.curves,
        animations: user.animations ?? seed.animations,
        startup: mergeEntries(seed.startup, user.startup),
        devices: user.devices ?? seed.devices,
        plugins: user.plugins ?? seed.plugins,
        layouts: {current, layouts},
    };
}

function canonicalChord(chord: string): string {
    const rank: Record<string, number> = {CTRL: 0, CONTROL: 0, SHIFT: 1, ALT: 2, SUPER: 3};
    return chord
        .split('+')
        .map((part) => part.trim().toUpperCase())
        .sort((left, right) => (rank[left] ?? 10) - (rank[right] ?? 10))
        .join('+');
}
function validateAction(action: unknown, path: string, errors: ConfigValidationError[]): void {
    if (!isRecord(action) || typeof action.type !== 'string') {
        errors.push({path, message: 'Ação ausente ou inválida.'});
        return;
    }
    if (
        action.type === 'launch-app' &&
        typeof action.desktopId === 'string' &&
        action.desktopId.trim()
    )
        return;
    if (action.type === 'command' && typeof action.command === 'string' && action.command.trim())
        return;
    if (
        action.type === 'shell-action' &&
        typeof action.name === 'string' &&
        /^[a-z0-9-]+$/.test(action.name) &&
        typeof action.command === 'string' &&
        action.command.trim()
    )
        return;
    if (
        action.type === 'hypr-dispatch' &&
        [
            'close',
            'pseudo',
            'fullscreen',
            'toggle-float',
            'focus',
            'move',
            'layout',
            'group-toggle',
            'group-next',
            'group-lock',
            'toggle-special-workspace',
            'resize',
            'drag',
            'exact-pseudo',
        ].includes(String(action.name))
    )
        return;
    errors.push({path, message: 'Ação não permitida ou incompleta.'});
}

export function validateUserConfig(seed: CompositorSeed, user: unknown): string[] {
    const errors: ConfigValidationError[] = [];
    if (!isRecord(user) || user.version !== 1)
        return ['version: versão de configuração desconhecida.'];

    for (const key of ['settings', 'input', 'binds', 'windowRules', 'startup'] as const)
        if (user[key] !== undefined && !isRecord(user[key]))
            errors.push({path: key, message: 'Era esperado um objeto.'});
    for (const key of [
        'monitorRules',
        'workspaceRules',
        'layerRules',
        'gestures',
        'curves',
        'animations',
        'devices',
        'plugins',
    ] as const)
        if (user[key] !== undefined && !Array.isArray(user[key]))
            errors.push({path: key, message: 'Era esperada uma lista.'});
    if (user.layouts !== undefined && !isRecord(user.layouts))
        errors.push({path: 'layouts', message: 'Era esperado um objeto.'});
    if (errors.length) return errors.map(({path, message}) => `${path}: ${message}`);
    const binds = isRecord(user.binds) ? user.binds : {};
    const candidate = mergeCompositorConfig(seed, user as unknown as UserConfig);
    const active = new Map<string, string>();
    for (const [index, bind] of candidate.binds.entries()) {
        const path = `binds.${bind.id || index}`;
        if (!bind.id || !/^[a-zA-Z0-9._-]+$/.test(bind.id))
            errors.push({path, message: 'Identificador inválido.'});
        if (typeof bind.keys !== 'string' || !bind.keys.trim())
            errors.push({path: `${path}.keys`, message: 'Atalho vazio.'});
        else {
            const parts = bind.keys.split('+').map((part) => part.trim().toUpperCase());
            const modifiers: Record<string, true> = {
                SUPER: true,
                SHIFT: true,
                CTRL: true,
                CONTROL: true,
                ALT: true,
                MOD2: true,
                MOD3: true,
                MOD5: true,
            };
            if (parts.some((part) => !part || !/^[A-Z0-9_:-]+$/.test(part)))
                errors.push({path: `${path}.keys`, message: 'Formato de atalho inválido.'});
            if (!parts.some((part) => !modifiers[part]))
                errors.push({path: `${path}.keys`, message: 'O atalho precisa conter uma tecla.'});
            const normalized = canonicalChord(bind.keys);
            const previous = active.get(normalized);
            if (previous)
                errors.push({
                    path: `${path}.keys`,
                    message: `Conflito entre ${previous} e ${bind.id}.`,
                });
            else active.set(normalized, bind.id);
        }
        validateAction(bind.action, `${path}.action`, errors);
    }

    for (const [id, override] of Object.entries(binds)) {
        if (!isRecord(override)) {
            errors.push({path: `binds.${id}`, message: 'Override inválido.'});
            continue;
        }
        if (override.disabled === true) continue;
        if (!candidate.binds.some((bind) => bind.id === id))
            errors.push({
                path: `binds.${id}`,
                message: 'Atalho precisa de um id e uma definição completos.',
            });
    }

    const startup = isRecord(user.startup) ? user.startup : {};
    for (const [id, entry] of Object.entries(startup)) {
        if (
            !isRecord(entry) ||
            (entry.desktopId !== undefined && typeof entry.desktopId !== 'string') ||
            (entry.command !== undefined && typeof entry.command !== 'string')
        )
            errors.push({path: `startup.${id}`, message: 'Aplicativo de inicialização inválido.'});
    }
    return errors.map(({path, message}) => `${path}: ${message}`);
}

function luaString(value: string): string {
    let output = '"';
    for (const char of value) {
        const code = char.codePointAt(0)!;
        if (char === '"' || char === '\\') output += `\\${char}`;
        else if (char === '\n') output += '\\n';
        else if (char === '\r') output += '\\r';
        else if (char === '\t') output += '\\t';
        else if (code < 32 || code === 127) output += `\\${String(code).padStart(3, '0')}`;
        else output += char;
    }
    return `${output}"`;
}

function lua(value: LuaValue): string {
    if (value === null) return 'nil';
    if (typeof value === 'string') return luaString(value);
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    if (Array.isArray(value)) return `{${value.map(lua).join(', ')}}`;
    return `{${Object.entries(value)
        .map(([key, child]) => `[${luaString(key)}] = ${lua(child)}`)
        .join(', ')}}`;
}

export function renderBindLua(bind: BindSpec): string {
    return `hl.bind(${luaString(bind.keys)}, ${dispatcher(bind.action)}, ${bindFlags(bind)})`;
}
function dispatcher(action: BindAction): string {
    if (action.type === 'launch-app')
        return `hl.dsp.exec_cmd(${luaString(`uwsm-app -t service -- ${action.desktopId}.desktop`)})`;
    if (action.type === 'command') return `hl.dsp.exec_cmd(${luaString(action.command)})`;
    if (action.type === 'shell-action') return `hl.dsp.exec_cmd(${luaString(action.command)})`;
    const args = action.args === undefined ? '' : lua(action.args);
    switch (action.name) {
        case 'close':
            return 'hl.dsp.window.close()';
        case 'pseudo':
            return 'hl.dsp.window.pseudo()';
        case 'fullscreen':
            return 'hl.dsp.window.fullscreen()';
        case 'toggle-float':
            return 'hl.dsp.window.float({ action = "toggle" })';
        case 'focus':
            return `hl.dsp.focus(${args})`;
        case 'move':
            return `hl.dsp.window.move(${args})`;
        case 'layout':
            return `hl.dsp.layout(${args})`;
        case 'group-toggle':
            return 'hl.dsp.group.toggle()';
        case 'group-next':
            return 'hl.dsp.group.next()';
        case 'group-lock':
            return 'hl.dsp.group.lock()';
        case 'toggle-special-workspace':
            return `hl.dsp.workspace.toggle_special(${args})`;
        case 'resize':
            return `hl.dsp.window.resize(${args})`;
        case 'drag':
            return 'hl.dsp.window.drag()';
        case 'exact-pseudo':
            return `function()
  hl.dsp.window.float({ action = "on" })()
  hl.dsp.window.resize({ x = 1920, y = 1080 })()
  hl.dsp.window.float({ action = "off" })()
  hl.dsp.window.pseudo()()
end`;
    }
}

function bindFlags(bind: BindSpec): string {
    const flags = bind.flags ?? {};
    const values: string[] = [];
    if (flags.locked) values.push('locked = true');
    if (flags.repeating) values.push('repeating = true');
    if (flags.release) values.push('release = true');
    if (flags.mouse) values.push('mouse = true');
    if (flags.nonConsuming) values.push('non_consuming = true');
    values.push(`description = ${luaString(bind.title)}`);
    return `{${values.join(', ')}}`;
}

function renderConfig(settings: Record<string, LuaValue>): string[] {
    const ordinary: Record<string, LuaValue> = {};
    const env: string[] = [];
    for (const [key, value] of Object.entries(settings)) {
        if ((key === 'env' || key === 'envd') && Array.isArray(value)) {
            for (const item of value) {
                if (typeof item !== 'string') continue;
                const split = item.indexOf(',');
                if (split < 0) continue;
                const suffix = key === 'envd' ? ', true' : ', false';
                env.push(
                    `hl.env(${luaString(item.slice(0, split).trim())}, ${luaString(item.slice(split + 1).trim())}${suffix})`
                );
            }
        } else ordinary[key] = value;
    }
    return [`hl.config(${lua(ordinary)})`, ...env];
}

function renderRule(
    api: 'window_rule' | 'layer_rule',
    name: string | null,
    match: Record<string, LuaValue>,
    effects: Record<string, LuaValue>
): string {
    const fields = [
        ...(name ? [`name=${luaString(name)}`] : []),
        `match=${lua(match as LuaValue)}`,
        ...Object.entries(effects).map(([key, value]) => `${key}=${lua(value)}`),
    ];
    return `hl.${api}({${fields.join(', ')}})`;
}

export function renderMonitorLua(monitor: MonitorProfile['monitors'][number]): string {
    const fields: Record<string, LuaValue> = {
        output: monitor.name,
        mode: monitor.resolution,
        position: monitor.position,
        scale: String(monitor.scale),
        transform: monitor.transform,
        vrr: monitor.vrr ?? -1,
        disabled: monitor.disabled,
    };
    if (monitor.mirror) fields.mirror = monitor.mirror;
    if (monitor.bitdepth != null) fields.bitdepth = monitor.bitdepth;
    if (monitor.cm != null) fields.cm = monitor.cm;
    if (monitor.sdrbrightness != null) fields.sdrbrightness = monitor.sdrbrightness;
    if (monitor.sdrsaturation != null) fields.sdrsaturation = monitor.sdrsaturation;
    return `hl.monitor(${lua(fields)})`;
}

export function renderWorkspaceRuleLua(workspace: string, monitor: string): string {
    return `hl.workspace_rule({workspace=${luaString(workspace)}, monitor=${luaString(monitor)}})`;
}

function renderCurve(curve: LuaValue): string {
    if (
        typeof curve !== 'object' ||
        curve === null ||
        Array.isArray(curve) ||
        typeof curve.name !== 'string'
    )
        throw new Error('invalid curve in compositor seed');
    const {name, ...definition} = curve;
    return `hl.curve(${luaString(name)}, ${lua(definition)})`;
}
export function renderHyprlandLua(config: CompositorSeed): string {
    const lines = config.plugins.map((plugin) => `hl.plugin.load(${luaString(plugin)})`);
    lines.push(
        ...renderConfig({
            ...config.settings,
            input: {
                ...config.input,
                ...(config.settings.input as Record<string, LuaValue> | undefined),
            },
        })
    );
    lines.push(...config.monitorRules.map((rule) => `hl.monitor(${lua(rule)})`));
    lines.push(...config.workspaceRules.map((rule) => `hl.workspace_rule(${lua(rule)})`));
    for (const rule of config.windowRules)
        if (rule.enabled !== false)
            lines.push(renderRule('window_rule', rule.id, rule.match, rule.effects));
    for (const rule of config.layerRules)
        if (rule.enabled !== false)
            lines.push(renderRule('layer_rule', null, rule.match, rule.effects));
    lines.push(...config.gestures.map((rule) => `hl.gesture(${lua(rule)})`));
    lines.push(...config.curves.map(renderCurve));
    lines.push(...config.animations.map((animation) => `hl.animation(${lua(animation)})`));
    for (const device of config.devices) lines.push(`hl.device(${lua(device)})`);
    const layout = config.layouts.current
        ? config.layouts.layouts[config.layouts.current]
        : undefined;
    if (layout) {
        for (const monitor of layout.monitors) lines.push(renderMonitorLua(monitor));
        for (const [workspace, monitor] of Object.entries(layout.workspaces))
            lines.push(renderWorkspaceRuleLua(workspace, monitor));
    }
    for (const startup of config.startup) {
        if (!startup.enabled) continue;
        const command = startup.desktopId
            ? `uwsm-app -t service -- ${startup.desktopId}.desktop`
            : startup.command;
        if (!command) continue;
        if (startup.phase === 'load') lines.push(`hl.exec_cmd(${luaString(command)})`);
        else
            lines.push(
                `hl.on("hyprland.start", function() hl.exec_cmd(${luaString(command)}) end)`
            );
    }
    for (const bind of config.binds) lines.push(renderBindLua(bind));
    if (config.extraLuaConfig.trim()) lines.push(config.extraLuaConfig.trim());
    return `${lines.filter(Boolean).join('\n')}\n`;
}
export function resolveUserConfig(
    seed: CompositorSeed,
    raw: unknown
): {user: UserConfig; effective: CompositorSeed; errors: string[]} {
    const empty: UserConfig = {version: 1};
    const errors = validateUserConfig(seed, raw);
    if (errors.length) return {user: empty, effective: seed, errors};
    const user = raw as UserConfig;
    return {user, effective: mergeCompositorConfig(seed, user), errors: []};
}
export type BindingOperation = {type: 'unbind'; keys: string} | {type: 'bind'; bind: BindSpec};

export function planBindingDiff(
    previous: readonly BindSpec[],
    next: readonly BindSpec[]
): BindingOperation[] {
    const before = new Map(previous.map((bind) => [bind.id, bind]));
    const after = new Map(next.map((bind) => [bind.id, bind]));
    const operations: BindingOperation[] = [];
    for (const [id, oldBind] of before) {
        const newBind = after.get(id);
        if (!newBind || JSON.stringify(oldBind) !== JSON.stringify(newBind))
            operations.push({type: 'unbind', keys: oldBind.keys});
    }
    for (const [id, newBind] of after) {
        const oldBind = before.get(id);
        if (!oldBind || JSON.stringify(oldBind) !== JSON.stringify(newBind))
            operations.push({type: 'bind', bind: newBind});
    }
    return operations;
}
export function migrateLegacyLayoutStore(legacy: unknown): {user: UserConfig; errors: string[]} {
    if (!isRecord(legacy) || legacy.version !== 1 || !isRecord(legacy.layouts))
        return {user: {version: 1}, errors: ['monitor-layouts.json has an unsupported schema']};
    const current = legacy.current;
    if (current !== null && typeof current !== 'string')
        return {user: {version: 1}, errors: ['monitor-layouts.json current layout is invalid']};
    for (const [name, profile] of Object.entries(legacy.layouts)) {
        if (
            !isRecord(profile) ||
            !Array.isArray(profile.monitors) ||
            !isRecord(profile.workspaces) ||
            profile.monitors.some(
                (monitor) =>
                    !isRecord(monitor) ||
                    typeof monitor.name !== 'string' ||
                    typeof monitor.resolution !== 'string' ||
                    typeof monitor.position !== 'string' ||
                    typeof monitor.scale !== 'number' ||
                    typeof monitor.transform !== 'number' ||
                    typeof monitor.disabled !== 'boolean'
            )
        )
            return {
                user: {version: 1},
                errors: [`monitor-layouts.json profile "${name}" is invalid`],
            };
    }
    return {
        user: {
            version: 1,
            layouts: {
                current,
                layouts: legacy.layouts as Record<string, MonitorProfile>,
            },
        },
        errors: [],
    };
}
export function renderDpmsLua(on: boolean, monitor?: string): string {
    const target = monitor === undefined ? '' : `, monitor=${luaString(monitor)}`;
    return `hl.dsp.dpms({action=${luaString(on ? 'on' : 'off')}${target}})`;
}
export function renderConfigOptionLua(path: string, value: LuaValue): string {
    return `hl.config({[${luaString(path.replaceAll(':', '.'))}]=${lua(value)}})`;
}

export function renderKeystrokeOverlaySubscriptionLua(enabled: boolean): string {
    if (!enabled)
        return [
            'if _G.shadeKeystrokeSubscription then',
            '    _G.shadeKeystrokeSubscription:remove()',
            '    _G.shadeKeystrokeSubscription = nil',
            'end',
        ].join('\n');
    return [
        'if not (_G.shadeKeystrokeSubscription and _G.shadeKeystrokeSubscription:is_active()) then',
        '    _G.shadeKeystrokeSubscription = hl.on("input.keyboard.key", function(keycode, _, state)',
        '        if state ~= 2 then',
        '            hl.dispatch(hl.dsp.event("shade-key:" .. tostring(keycode) .. "," .. tostring(state)))',
        '        end',
        '    end)',
        'end',
    ].join('\n');
}
