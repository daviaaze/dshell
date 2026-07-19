/**
 * Test runner — builds and runs all test suites sequentially.
 *
 * Usage: node tools/run-tests.mjs
 */

import {execSync} from "node:child_process";
import {readdirSync} from "node:fs";
import {resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testsDir = resolve(__dirname, '../src/lib/__tests__');
const buildDir = resolve(__dirname, '../build/test');

// Tests skipped due to pre-existing GI or runner limitations
const SKIP = new Set(['networkUtils', 'requestHandler', 'deferredSingleton', 'all', 'test-runner']);

function lastSummaryLine(text) {
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('/')) return lines[i];
    }
    return null;
}

function countResult(text) {
    const summary = lastSummaryLine(text);
    if (!summary) return {passed: 0, failed: 0};
    const m = summary.match(/(\d+)\/(\d+) passed/);
    if (!m) return {passed: 0, failed: 0};
    return {passed: parseInt(m[1]), failed: parseInt(m[2]) - parseInt(m[1])};
}

const testFiles = readdirSync(testsDir)
    .filter(f => f.endsWith('.test.ts') && !SKIP.has(f.replace('.test.ts', '')))
    .sort();

let totalPassed = 0;
let totalFailed = 0;

for (const file of testFiles) {
    const name = file.replace('.test.ts', '');

    // Build
    try {
        execSync(
            `node -e "require('esbuild').buildSync({entryPoints:['src/lib/__tests__/${file}'],bundle:true,outfile:'build/test/${name}.test.js',format:'esm',external:['gi://*'],alias:{'#':'./src'},target:'es2022'})"`,
            {stdio: 'pipe'}
        );
    } catch (e) {
        console.log(`✗ ${name} — build failed`);
        console.log(`  ${e.stderr?.toString() || e.message}`);
        totalFailed++;
        continue;
    }

    // Run under gjs
    try {
        const output = execSync(
            `nix develop -c gjs -m build/test/${name}.test.js 2>&1`,
            {stdio: 'pipe', timeout: 30000}
        );
        const text = output.stdout.toString();
        console.log(text);
        const r = countResult(text);
        totalPassed += r.passed;
        totalFailed += r.failed;
    } catch (e) {
        const text = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
        console.log(text);
        const r = countResult(text);
        totalPassed += r.passed;
        totalFailed += r.failed || Math.max(text.split('\n').filter(l => l.includes('✗')).length, 1);
    }
}

const total = totalPassed + totalFailed;
console.log(`\n=== ${totalPassed}/${total} passed ===`);
if (totalFailed > 0) {
    console.log(`  ${totalFailed} FAILED`);
    process.exit(1);
} else {
    console.log('  All tests passed');
}
