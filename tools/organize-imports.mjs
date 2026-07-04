#!/usr/bin/env node
/**
 * Organize imports in GJS TypeScript files following the GJS style guide.
 *
 * Groups (separated by blank lines, sorted alphabetically):
 *   1. GI imports  (gi://...)
 *   2. Npm imports (gnim, gettext, system, etc.)
 *   3. Local imports (#/, ./, ../)
 *
 * Strategy: find all complete import statements (including multiline),
 * remove them from the file, group+sort, and reinsert at the top.
 */

import {readFileSync, writeFileSync, readdirSync} from 'fs';
import {join} from 'path';

// ── Helpers ────────────────────────────────────────────────────────

function findFiles(dir, exts) {
    const results = [];
    const entries = readdirSync(dir, {withFileTypes: true});
    for (const entry of entries) {
        const fp = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules')
            results.push(...findFiles(fp, exts));
        else if (entry.isFile() && exts.some(e => entry.name.endsWith(e)))
            results.push(fp);
    }
    return results;
}

const GI_RE = /from\s+['"]gi:\/\//;
const LOCAL_RE = /from\s+['"](\.\/|\.\.\/|#\/)/;

function categorize(text) {
    if (GI_RE.test(text)) return 'gi';
    if (LOCAL_RE.test(text)) return 'local';
    return 'npm';
}

function sortKey(text) {
    const m = text.match(/from\s+['"](.+?)['"]/);
    return m ? m[1] : text;
}

/** Extract all complete import statements from content, return [imports[], remainingLines] */
function extractImports(lines) {
    const imports = [];
    const nonImportLines = [];
    let i = 0;

    while (i < lines.length) {
        const trimmed = lines[i].trimEnd();

        // Start of an import (or /// reference directive)
        if (/^import\s/.test(trimmed) || /^\/\/\/\s*<reference/.test(trimmed)) {
            let buf = trimmed;
            i++;

            // Consume continuation lines until we hit a semicolon
            while (i < lines.length) {
                const next = lines[i].trimEnd();
                // If this next line starts a new import, stop
                if (/^import\s/.test(next)) break;
                // Skip blank lines (they separate import groups)
                if (next === '') {
                    i++;
                    break;
                }
                buf += '\n' + next;
                if (buf.includes(';')) {
                    i++;
                    break;
                }
                i++;
            }

            // Clean trailing semicolon
            imports.push(buf.replace(/;\s*$/, ''));
        } else {
            nonImportLines.push(lines[i]);
            i++;
        }
    }

    return [imports, nonImportLines];
}

// ── Main ───────────────────────────────────────────────────────────

const files = findFiles('src', ['.ts', '.tsx']).filter(
    f => !f.includes('node_modules') && !f.includes('/@girs/')
);
let changed = 0;

for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    // Find leading content (shebang, comments, directives) before first import
    let leading = [];
    let firstImportIdx = lines.findIndex(l => /^import\s/.test(l.trim()) || /^\/\/\/\s*<reference/.test(l.trim()));
    if (firstImportIdx > 0) {
        leading = lines.slice(0, firstImportIdx);
    }

    // Only process from the first import onward
    const relevantLines = firstImportIdx >= 0 ? lines.slice(firstImportIdx) : lines;
    const [imports, rest] = extractImports(relevantLines);
    if (imports.length === 0) continue;

    // Filter actual import statements (skip /// reference directives)
    const actualImports = imports.filter(l => /^import\s/.test(l.trim()));

    // Group and sort
    const groups = {gi: [], npm: [], local: []};
    for (const imp of actualImports) {
        groups[categorize(imp)].push(imp);
    }
    for (const key of Object.keys(groups)) {
        groups[key].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    }

    // Build new import block
    const newBlock = [];
    const pushGroup = (arr) => {
        if (arr.length) {
            if (newBlock.length) newBlock.push('');
            newBlock.push(...arr.map(s => s + ';'));
        }
    };
    pushGroup(groups.gi);
    pushGroup(groups.npm);
    pushGroup(groups.local);

    const newContent = [...leading, ...newBlock, ...rest].join('\n');

    if (newContent !== content) {
        writeFileSync(file, newContent, 'utf-8');
        console.log(`✓ ${file.replace(process.cwd() + '/', '')}`);
        changed++;
    }
}

console.log(`\nOrganized imports in ${changed}/${files.length} files.`);
