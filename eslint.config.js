// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    // Ignore generated type definitions and build artifacts
    {ignores: ['**/node_modules/**', '**/@girs/**', 'build/**']},

    eslint.configs.recommended,
    ...tseslint.configs.recommended,

    // ── Project-specific rules ─────────────────────────────────────────
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',

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
            eqeqeq: ['error', 'always'],
            complexity: ['warn', {max: 15}],
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
        },
    }
);
