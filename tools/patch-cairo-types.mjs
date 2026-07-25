#!/usr/bin/env node
/**
 * Patches generated gnim cairo types.
 *
 * gnim v2's gi://cairo?version=1.0 ships an empty Context interface, while the
 * functional drawing API (rectangle, setSourceRGBA, etc.) lives in a separate
 * module-scoped namespace that isn't reachable from the import. This patches
 * the generated cairo-1.0.d.ts to add the methods the project uses.
 *
 * Run after `gnim types` (see package.json "types" script).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const file = join(root, '.gnim/types/gi/cairo-1.0.d.ts');
const src = readFileSync(file, 'utf8');

const empty = 'interface Context {\n            }';
const filled = `interface Context {
                rectangle(x: number, y: number, width: number, height: number): void
                setSourceRGBA(red: number, green: number, blue: number, alpha: number): void
                moveTo(x: number, y: number): void
                fill(): void
                stroke(): void
                showText(utf8: string): void
                setLineWidth(width: number): void
                setFontSize(size: number): void
                setDash(dashes: number[], offset: number): void
                setLineCap(lineCap: number): void
                lineTo(x: number, y: number): void
                textExtents(utf8: string): {
                    x_bearing: number
                    y_bearing: number
                    width: number
                    height: number
                    x_advance: number
                    y_advance: number
                }
                selectFontFace(family: string, slant: number, weight: number): void
            }`;

if (!src.includes(empty)) {
    if (src.includes('interface Context {')) {
        console.log('cairo-1.0.d.ts already patched or shaped differently — skipping');
        process.exit(0);
    }
    console.error('Could not find empty Context interface in cairo-1.0.d.ts');
    process.exit(1);
}

writeFileSync(file, src.replace(empty, filled));
console.log('Patched cairo-1.0.d.ts Context interface');
