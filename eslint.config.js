// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

export default tseslint.config(
    // Ignore generated type definitions and build artifacts
    {ignores: ['**/node_modules/**', '**/@girs/**', 'build/**', 'dist/**', '**/.gnim/**', 'scripts/**']},

    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    sonarjs.configs.recommended,

    // ═════════════════════════════════════════════════════════════════════
    //  PACKAGE BOUNDARY ENFORCEMENT — @shade/* import DAG
    //  Enforces the dependency graph: apps → widgets → services → core
    //  and style → core. Any violation fails lint.
    // ═════════════════════════════════════════════════════════════════════

    // -- packages/core — leaf package, cannot import any @shade/* packages
    {
        files: ['packages/core/src/**'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [{
                    group: ['@shade/*'],
                    message: '@shade/core is the leaf package and cannot import any @shade/* packages',
                }],
            }],
        },
    },

    // -- packages/services — can only import @shade/core
    {
        files: ['packages/services/src/**'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    { group: ['@shade/widgets/*'], message: '@shade/services cannot depend on @shade/widgets' },
                    { group: ['@shade/style/*'],   message: '@shade/services cannot depend on @shade/style' },
                    { group: ['@shade/shell/*', '@shade/greeter/*', '@shade/share-picker/*'], message: '@shade/services cannot import apps' },
                ],
            }],
        },
    },

    // -- packages/style — can only import @shade/core
    {
        files: ['packages/style/src/**'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    { group: ['@shade/services/*'], message: '@shade/style cannot depend on @shade/services' },
                    { group: ['@shade/widgets/*'],  message: '@shade/style cannot depend on @shade/widgets' },
                    { group: ['@shade/shell/*', '@shade/greeter/*', '@shade/share-picker/*'], message: '@shade/style cannot import apps' },
                ],
            }],
        },
    },

    // -- apps/greeter — can import @shade/core, @shade/services, but not widgets/style
    {
        files: ['apps/greeter/src/**'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    { group: ['@shade/widgets/*', '@shade/style/*'], message: '@shade/greeter cannot depend on @shade/widgets or @shade/style' },
                ],
            }],
        },
    },

    // -- apps/share-picker — same as greeter
    {
        files: ['apps/share-picker/src/**'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    { group: ['@shade/widgets/*', '@shade/style/*'], message: '@shade/share-picker cannot depend on @shade/widgets or @shade/style' },
                ],
            }],
        },
    },

    // ═════════════════════════════════════════════════════════════════════
    //  WIDGET LAYER GUARD — no Process, spawns, or raw GI services
    //  Combined with package-boundary rules so exemption blocks below
    //  replace only the specific GI exemptions, not the @shade rules.
    // ═════════════════════════════════════════════════════════════════════

    // -- Core widget restrictions (applies to ALL widget files)
    {
        files: ['packages/widgets/src/**'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    // Package boundary — @shade/widgets cannot import apps
                    { group: ['@shade/shell/*', '@shade/greeter/*', '@shade/share-picker/*'], message: '@shade/widgets cannot import apps' },

                    // GI service restrictions — widgets must use service abstractions
                    { group: ['gi://AstalAuth*'],      message: 'Widgets must not import AstalAuth directly. Use the AuthSession service instead.' },
                    { group: ['gi://Gtk4SessionLock*'], message: 'Widgets must not import Gtk4SessionLock directly. Use the AuthSession service instead.' },
                    { group: ['gi://GWeather*'],        message: 'Widgets must not import GWeather directly. Use the Weather service getters instead.' },
                    { group: ['gi://cairo*'],           message: 'Widgets must not import Cairo directly. Encapsulate drawing logic behind a service method.' },
                ],
            }],
            'no-restricted-properties': [
                'error',
                { object: 'GLib', property: 'spawn_command_line_async', message: 'Widgets must not execute shell commands directly. Call a service method instead.' },
                { object: 'GLib', property: 'spawn_async',              message: 'Widgets must not execute shell commands directly. Call a service method instead.' },
                { object: 'GLib', property: 'spawn_command_line',       message: 'Widgets must not execute shell commands directly. Call a service method instead.' },
            ],
        },
    },

    // -- Exemptions: widget files that legitimately use direct GI imports
    //    (capture-related widgets that bypass the service layer)
    //    ONLY replaces the no-restricted-imports — the package-boundary
    //    @shade restrictions are preserved in the block above.
    {
        files: [
            'packages/widgets/src/recording-boundary/**',
            'packages/widgets/src/region-selector/**',
            'packages/widgets/src/screenshot-ui/**',
        ],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    // Keep package-boundary restriction (apps not accessible from widgets)
                    { group: ['@shade/shell/*', '@shade/greeter/*', '@shade/share-picker/*'], message: '@shade/widgets cannot import apps' },
                ],
            }],
        },
    },

    // ═════════════════════════════════════════════════════════════════════
    //  PROJECT-SPECIFIC RULES
    // ═════════════════════════════════════════════════════════════════════
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',

            // GJS-specific restrictions — ban legacy globals
            'no-restricted-globals': [
                'error',
                { name: 'log',      message: 'Use console.log() instead of log()' },
                { name: 'logError', message: 'Use console.warn() instead of logError()' },
            ],

            // Ban legacy Lang namespace (ES6+ replaces it)
            'no-restricted-properties': [
                'error',
                { object: 'Lang', property: 'bind',           message: 'Use arrow functions instead of Lang.bind()' },
                { object: 'Lang', property: 'copyProperties', message: 'Use Object.assign() or spread instead of Lang.copyProperties()' },
                { object: 'Lang', property: 'Class',          message: 'Use ES6 classes instead of Lang.Class' },
            ],

            // ── Quality rules ───────────────────────────────────────────
            '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
            'eqeqeq': ['error', 'always'],
            'complexity': ['warn', {max: 18}],
            'consistent-return': 'error',
            'no-var': 'error',
            'no-throw-literal': 'error',
            'prefer-const': 'error',
            'no-useless-rename': 'error',
            'object-shorthand': ['error', 'always'],
            'camelcase': ['warn', {properties: 'never', ignoreDestructuring: true}],

            // ── SonarJS rules ───────────────────────────────────────────
            'sonarjs/cognitive-complexity': ['warn', 20, 'silence-issues'],
            'sonarjs/max-lines-per-function': ['warn', {maximum: 100}],
            'sonarjs/no-duplicate-string': ['warn', {threshold: 5}],
            'sonarjs/no-identical-functions': ['warn', 3],
            'sonarjs/nested-control-flow': ['warn', {maximumNestingLevel: 5}],
            'sonarjs/no-nested-functions': 'warn',
            'sonarjs/no-nested-conditional': 'warn',
        },
    },

    // ── Test files — explicit string literals in test cases are
    // intentional (readability over DRY); sonarjs recommends excluding
    // tests. Must come last: flat config is last-match-wins.
    {
        files: ['**/__tests__/**'],
        rules: {
            'sonarjs/no-duplicate-string': 'off',
            'sonarjs/max-lines-per-function': 'off',
        },
    }
);
