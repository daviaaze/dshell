// gnim leaves imports it cannot resolve in the bundle instead of failing; GJS
// then aborts at startup. Fail the build when a bundled module still imports
// anything other than GI namespaces, GResources or GJS built-in modules.
import {readFileSync} from 'node:fs';

const [file, label] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const builtins = new Set(['cairo', 'console', 'gettext', 'system']);
const staticImports =
    /^\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;
const dynamicImports = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

const specifiers = new Set();
for (const match of source.matchAll(staticImports)) specifiers.add(match[1] ?? match[2]);
for (const match of source.matchAll(dynamicImports)) specifiers.add(match[1]);

const unresolved = [...specifiers].filter(
    (specifier) =>
        !specifier.startsWith('gi://') &&
        !specifier.startsWith('resource://') &&
        !builtins.has(specifier)
);
if (unresolved.length > 0) {
    console.error(`${label}: unresolved imports left in the bundle: ${unresolved.join(', ')}`);
    process.exit(1);
}
