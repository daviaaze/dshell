// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';            
                                                                                                   
export default tseslint.config(
    // Ignore generated type definitions and build artifacts
    {ignores: ['**/node_modules/**', '**/@girs/**', 'build/**']},

    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    sonarjs.configs.recommended,

    // ── Widget/service boundary guard — no Process, spawns, or raw GI services ──
    {
        files: ['src/widget/**'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: '#/lib/core/process',
                            message:
                                'Widgets must not call Process.exec directly. ' +
                                'Encapsulate shell commands behind a service method.',
                        },
                    ],
                    patterns: [
                        {
                            group: ['gi://AstalAuth*'],
                            message:
                                'Widgets must not import AstalAuth directly. ' +
                                'Use the AuthSession service instead.',
                        },
                        {
                            group: ['gi://Gtk4SessionLock*'],
                            message:
                                'Widgets must not import Gtk4SessionLock directly. ' +
                                'Use the AuthSession service instead.',
                        },
                        {
                            group: ['gi://GWeather*'],
                            message:
                                'Widgets must not import GWeather directly. ' +
                                'Use the Weather service getters instead.',
                        },
                        {
                            group: ['gi://cairo*'],
                            message:
                                'Widgets must not import Cairo directly. ' +
                                'Encapsulate drawing logic behind a service method.',
                        },
                    ],
                },
            ],
            'no-restricted-properties': [
                'error',
                {
                    object: 'GLib',
                    property: 'spawn_command_line_async',
                    message:
                        'Widgets must not execute shell commands directly. ' +
                        'Call a service method instead.',
                },
                {
                    object: 'GLib',
                    property: 'spawn_async',
                    message:
                        'Widgets must not execute shell commands directly. ' +
                        'Call a service method instead.',
                },
                {
                    object: 'GLib',
                    property: 'spawn_command_line',
                    message:
                        'Widgets must not execute shell commands directly. ' +
                        'Call a service method instead.',
                },
            ],
        },
    },
    // ── Exemptions: widget files that legitimately use these imports ──
    {
        files: [
            'src/widget/common/sunArc.tsx',
            'src/widget/recording-boundary/**',
            'src/widget/region-selector/**',
            'src/widget/screenshot-ui/**',
        ],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: '#/lib/core/process',
                            message:
                                'Widgets must not call Process.exec directly. ' +
                                'Encapsulate shell commands behind a service method.',
                        },
                    ],
                },
            ],
        },
    },




    // ── Project-specific rules ─────────────────────────────────────────
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',

            // GJS-specific restrictions — ban legacy globals
            'no-restricted-globals': [
                'error',
                {
                    name: 'log',
                    message: 'Use console.log() instead of log()',
                },
                {
                    name: 'logError',
                    message: 'Use console.warn() instead of logError()',
                },
            ],

            // Ban legacy Lang namespace (ES6+ replaces it)
            'no-restricted-properties': [
                'error',
                {
                    object: 'Lang',
                    property: 'bind',
                    message: 'Use arrow functions instead of Lang.bind()',
                },
                {
                    object: 'Lang',
                    property: 'copyProperties',
                    message:
                        'Use Object.assign() or spread instead of Lang.copyProperties()',
                },
                {
                    object: 'Lang',
                    property: 'Class',
                    message: 'Use ES6 classes instead of Lang.Class',
                },
            ],

            // ── Quality rules ───────────────────────────────────────────
            '@typescript-eslint/no-unused-vars': [
                'error',
                {argsIgnorePattern: '^_'},
            ],
            eqeqeq: ['error', 'always'],
            complexity: ['warn', {max: 18}],
            'consistent-return': 'error',
            'no-var': 'error',
            'no-throw-literal': 'error',
            'prefer-const': 'error',
            'no-useless-rename': 'error',
            'object-shorthand': ['error', 'always'],
            'camelcase': [
                'warn',
                {properties: 'never', ignoreDestructuring: true},
            ],

            // ── SonarJS rules ───────────────────────────────────────────
            'sonarjs/cognitive-complexity': ['warn', 20, 'silence-issues'],
            'sonarjs/max-lines-per-function': ['warn', {maximum: 100}],
            'sonarjs/no-duplicate-string': ['warn', {threshold: 5}],
            'sonarjs/no-identical-functions': ['warn', 3],
            'sonarjs/nested-control-flow': ['warn', {maximumNestingLevel: 5}],
            'sonarjs/no-nested-functions': 'warn',
            'sonarjs/no-nested-conditional': 'warn',
        },
    }
);
