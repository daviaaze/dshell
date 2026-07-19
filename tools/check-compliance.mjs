#!/usr/bin/env node
/**
 * Shade Shell compliance linter — enforces the conventions declared in
 * docs/specs/_template.md and the project design docs:
 *
 *   theme           No hardcoded colors; inline css must be layout-only;
 *                   radii via --shade-radius.
 *   componentization  Files stay small and focused.
 *   event-driven    No polling/intervals in the widget layer; UI binds to
 *                   service state instead.
 *   logging         Use #/lib/core/logger, not console/print.
 *   async           No synchronous spawn/file IO; use async utils.
 *   reactivity      gnim primitives (createBinding/createComputed/createState)
 *                   used at component top level, not inside event handlers;
 *                   singletons hoisted out of JSX props.
 *
 * Suppression:
 *   // comply-allow: <rule>          — allow one rule on this line
 *   // comply-allow-file: <rule>     — allow one rule for the whole file
 *
 * Usage: node tools/check-compliance.mjs [--warnings-as-errors] [paths...]
 */
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const warningsAsErrors = process.argv.includes('--warnings-as-errors');
const extraPaths = process.argv
    .slice(2)
    .filter(a => !a.startsWith('--'))
    .map(p => join(ROOT, p));

// ── Rule definitions ─────────────────────────────────────────────────────────
// Each rule: {id, group, severity, test(line, file) -> string|null (message)}
// `line` is the raw source line; helpers below keep tests readable.

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\s*\(/;
const COLOR_PROPS_RE =
    /(?:^|[;\s{])(color|background|background-color|border-color|outline-color|box-shadow|text-shadow|caret-color)\s*:/;

/** Files allowed to define literal colors (theme definitions themselves). */
const COLOR_ALLOW_FILES = [
    /src\/style\/palette\.ts$/,
    /src\/style\/theme\.ts$/,
    /src\/lib\/settings\/schema\.ts$/, // user-configurable defaults
];

const RULES = [
    // ── theme ──
    {
        id: 'theme/hardcoded-color',
        severity: 'error',
        test: (line, file) =>
            COLOR_RE.test(line) &&
            !/^\s*(\*|\/{2})/.test(line.trim()) &&
            !COLOR_ALLOW_FILES.some(re => re.test(file))
                ? 'hardcoded color — use a --shade-* token or Adw named color'
                : null,
    },
    {
        id: 'theme/inline-css-color',
        severity: 'error',
        test: line =>
            /css=\{?['"`]/.test(line) && COLOR_PROPS_RE.test(line)
                ? 'inline css sets a color property — colors belong in the theme (useStyle is for layout only)'
                : null,
    },
    {
        id: 'theme/hardcoded-radius',
        severity: 'warning',
        test: line =>
            /border-radius\s*:\s*\d+px/.test(line)
                ? 'hardcoded border-radius — use var(--shade-radius)'
                : null,
    },

    // ── event-driven ──
    {
        id: 'event-driven/set-interval',
        severity: 'error',
        test: line =>
            /\bsetInterval\s*\(/.test(line)
                ? 'setInterval — use GLib.timeout_add with a clear lifecycle owner'
                : null,
    },
    {
        id: 'event-driven/widget-polling',
        severity: 'warning',
        test: (line, file) =>
            /^src\/widget\//.test(file) &&
            /GLib\.timeout_add(_seconds)?\s*\(/.test(line)
                ? 'timer in widget layer — bind to service state instead of polling (see event-driven design doc)'
                : null,
    },

    // ── logging ──
    {
        id: 'logging/console',
        severity: 'error',
        test: (line, file) =>
            /\bconsole\.(log|debug|info)\s*\(/.test(line) &&
            !/src\/lib\/core\/logger\.ts$/.test(file)
                ? 'console.* — use the logger from #/lib/core/logger (supports levels + categories)'
                : null,
    },
    {
        id: 'logging/console-warn-error',
        severity: 'warning',
        test: (line, file) =>
            /\bconsole\.(warn|error)\s*\(/.test(line) &&
            !/src\/lib\/core\/logger\.ts$/.test(file)
                ? 'console.warn/error — prefer logger.warn/logger.error for consistent [Shade] formatting'
                : null,
    },
    {
        id: 'logging/print',
        severity: 'warning',
        test: (line, file) =>
            /^\s*print\s*\(/.test(line) &&
            !/src\/lib\/core\/logger\.ts$/.test(file) &&
            !/src\/lib\/core\/stdout\.ts$/.test(file)
                ? 'bare print() — use the logger from #/lib/core/logger (or printOut from #/lib/core/stdout when stdout is the protocol contract)'
                : null,
    },

    // ── async ──
    {
        id: 'async/sync-spawn',
        severity: 'error',
        test: line =>
            /GLib\.spawn_(sync|command_line_sync)\s*\(/.test(line)
                ? 'synchronous spawn blocks the main loop — use the async helper in #/lib/utils/process'
                : null,
    },
    {
        id: 'async/sync-file-read',
        severity: 'warning',
        test: (line, file) =>
            /GLib\.file_get_contents\s*\(/.test(line) &&
            !/src\/lib\/core\/file\.ts$/.test(file)
                ? 'synchronous file read — prefer the async helpers in #/lib/core/file'
                : null,
    },

    // ── reactivity (gnim/astal) ──
    {
        id: 'reactivity/hook-in-handler',
        severity: 'error',
        test: line =>
            /(?<![a-zA-Z])on[A-Z]\w*=\{[^}]*\b(createBinding|createComputed|createState)\s*\(/.test(
                line
            )
                ? 'gnim primitive created inside an event handler — bindings must be created at component top level'
                : null,
    },
    {
        id: 'reactivity/singleton-in-jsx',
        severity: 'warning',
        test: line =>
            /^\s*\w+={[^}]*\.get_default\(\)/.test(line)
                ? 'get_default() inside a JSX prop — hoist the singleton to the component top so the binding is stable'
                : null,
    },
];

// ── File-level checks (not line-based) ───────────────────────────────────────
const MAX_FILE_LINES = 400; // componentization guardrail
const MAX_FILE_LINES_SEVERITY = 'warning';

// ── Scanner ──────────────────────────────────────────────────────────────────
function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            if (entry === 'node_modules' || entry.startsWith('.')) continue;
            yield* walk(full);
        } else if (/\.(ts|tsx|css)$/.test(entry)) {
            yield full;
        }
    }
}

const findings = [];
const roots = extraPaths.length > 0 ? extraPaths : [SRC];

for (const root of roots) {
    for (const file of walk(root)) {
        const rel = relative(ROOT, file);
        if (rel.includes('__tests__')) continue;

        const lines = readFileSync(file, 'utf8').split('\n');
        const fileAllows = new Set(
            lines
                .filter(l => l.includes('comply-allow-file:'))
                .flatMap(l =>
                    l
                        .split('comply-allow-file:')[1]
                        .trim()
                        .split(/[,\s]+/)
                        .filter(Boolean)
                )
        );

        // file-level componentization check
        if (
            lines.length > MAX_FILE_LINES &&
            !fileAllows.has('componentization/file-size')
        ) {
            findings.push({
                file: rel,
                line: 0,
                rule: 'componentization/file-size',
                severity: MAX_FILE_LINES_SEVERITY,
                message: `${lines.length} lines (limit ${MAX_FILE_LINES}) — split into focused components/services`,
            });
        }

        lines.forEach((line, i) => {
            const lineAllows = line.includes('comply-allow:')
                ? line
                      .split('comply-allow:')[1]
                      .trim()
                      .split(/[,\s]+/)
                      .filter(Boolean)
                : [];

            for (const rule of RULES) {
                if (
                    fileAllows.has(rule.id) ||
                    lineAllows.includes(rule.id)
                )
                    continue;
                const message = rule.test(line, rel);
                if (message)
                    findings.push({
                        file: rel,
                        line: i + 1,
                        rule: rule.id,
                        severity: rule.severity,
                        message,
                    });
            }
        });
    }
}

// ── Report ───────────────────────────────────────────────────────────────────
findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

let errors = 0;
let warnings = 0;
for (const f of findings) {
    const isError =
        f.severity === 'error' || (warningsAsErrors && f.severity === 'warning');
    if (f.severity === 'error') errors++;
    else warnings++;
    const tag = f.severity === 'error' ? 'ERROR' : 'warn ';
    const loc = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.log(`${tag}  ${loc}  [${f.rule}] ${f.message}`);
}

console.log(
    `\n${findings.length} finding(s): ${errors} error(s), ${warnings} warning(s)`
);
process.exit(errors > 0 || (warningsAsErrors && warnings > 0) ? 1 : 0);
