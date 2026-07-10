#!/usr/bin/env node
/**
 * esbuild wrapper — adds the `#` → `<source-root>/src` path alias.
 *
 * The esbuild CLI doesn't support the `alias` option, so we use the
 * JavaScript API instead.
 *
 * Usage: node tools/build.mjs <entry> <outfile> [--source-root <path>] [flags...]
 *
 * Flags:
 *   --source-root <path>  Source root directory (for resolving # alias)
 *   --define <key> <val>  Set a define
 *   --external <pattern>  Mark a module as external
 *   --loader <ext=type>   Set a loader for a file extension
 *   --format <format>     Output format (esm, cjs, iife)
 *   --target <target>     Target environment
 *   --platform <platform> Platform (browser, node, neutral)
 */
import esbuild from 'esbuild';
import {resolve} from 'node:path';

const args = process.argv.slice(2);
const entry = args.shift();
const outfile = args.shift();

const options = {
    entryPoints: [entry],
    outfile,
    bundle: true,
    sourcemap: 'inline',
};

let sourceRoot = null;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source-root' && i + 1 <= args.length) {
        sourceRoot = args[++i];
    } else if (arg === '--define' && i + 2 <= args.length) {
        const key = args[++i];
        const value = args[++i];
        if (!options.define) options.define = {};
        options.define[key] = value.startsWith('"') ? value : `"${value}"`;
    } else if (arg === '--external' && i + 1 <= args.length) {
        const pattern = args[++i];
        if (!options.external) options.external = [];
        options.external.push(pattern);
    } else if (arg === '--loader' && i + 1 <= args.length) {
        const loader = args[++i];
        const eqIdx = loader.indexOf('=');
        if (eqIdx !== -1) {
            if (!options.loader) options.loader = {};
            options.loader[loader.slice(0, eqIdx)] = loader.slice(eqIdx + 1);
        }
    } else if (arg === '--format' && i + 1 <= args.length) {
        options.format = args[++i];
    } else if (arg === '--target' && i + 1 <= args.length) {
        options.target = args[++i];
    } else if (arg === '--platform' && i + 1 <= args.length) {
        options.platform = args[++i];
    }
}

// Set the # alias using the source root, or fall back to the entry's directory
if (sourceRoot) {
    options.alias = { '#': resolve(sourceRoot, 'src') };
} else {
    // Fall back to ./src relative to the current working directory
    options.alias = { '#': resolve(process.cwd(), 'src') };
}

try {
    await esbuild.build(options);
} catch (e) {
    console.error(e.message);
    process.exit(1);
}