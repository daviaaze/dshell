/**
 * Phase 4 codemod: move src/{lib, widget, style, apps} → packages/ + apps/
 * layout with `@shade/*` import aliases and git-mv history preservation.
 *
 * Usage:  node scripts/package-codemod.mjs
 * After:  npx tsc --noEmit   (fix any remaining issues)
 *         npx madge --circular ...  (verify 0 cycles)
 */

import fs from 'fs';
import path from 'path';
import {execSync} from 'child_process';

const ROOT = execSync('git rev-parse --show-toplevel', {encoding:'utf8'}).trim();
process.chdir(ROOT);

// ── Package definitions ──────────────────────────────────────────────
// Each package: {srcDir, destDir, tsName (for @shade/tsName)}
const PACKAGES = [
  {name: 'packages/core', src: 'src/lib/core', dest: 'packages/core/src', tsName: 'core'},
  {name: 'packages/services', src: 'src/lib/services', dest: 'packages/services/src', tsName: 'services'},
  {name: 'packages/widgets', src: 'src/widget', dest: 'packages/widgets/src', tsName: 'widgets'},
  {name: 'packages/style', src: 'src/style', dest: 'packages/style/src', tsName: 'style'},
  {name: 'apps/shell', src: 'src/apps/shell', dest: 'apps/shell/src', tsName: null},
  {name: 'apps/greeter', src: 'src/apps/greeter', dest: 'apps/greeter/src', tsName: null},
  {name: 'apps/share-picker', src: 'src/apps/share-picker', dest: 'apps/share-picker/src', tsName: null},
];

// Loose files in src/lib/ root
const LIB_ROOT = [
  {src: 'src/lib/decorators.ts', dest: 'packages/core/src/decorators.ts'},
  {src: 'src/lib/hyprland.ts', dest: 'packages/services/src/hyprland.ts'},
  {src: 'src/lib/utils/monitors.ts', dest: 'packages/services/src/utils/monitors.ts'},
  {src: 'src/lib/settings/index.ts', dest: 'packages/services/src/settings/index.ts'},
  {src: 'src/lib/settings/schema.gschema.ts', dest: 'packages/services/src/settings/schema.gschema.ts'},
  {src: 'src/lib/settings/screenCapture.ts', dest: 'packages/services/src/settings/screenCapture.ts'},
  {src: 'src/lib/__tests__', dest: 'packages/services/src/__tests__'},
];

// Types: keep in src/types for now or move to core
const TYPES = {src: 'src/types', dest: 'packages/core/src/types'};

// ── Gather ALL old→new mappings ─────────────────────────────────────

const oldToNew = new Map();

function addMapping(src, dest) {
  oldToNew.set(path.resolve(src), path.resolve(dest));
}

// Walk directory, add mapping for each file
function walkAndMap(srcDir, destDir, filter) {
  if (!fs.existsSync(srcDir)) return;
  const files = fs.readdirSync(srcDir, {withFileTypes: true});
  for (const f of files) {
    const src = path.join(srcDir, f.name);
    const dest = path.join(destDir, f.name);
    if (f.isDirectory()) {
      walkAndMap(src, dest, filter);
      // Also add the directory itself
      if (!oldToNew.has(path.resolve(src))) {
        oldToNew.set(path.resolve(src), path.resolve(dest));
      }
    } else if (!filter || filter(f.name)) {
      addMapping(src, dest);
    }
  }
}

// Map packages
for (const pkg of PACKAGES) {
  walkAndMap(pkg.src, pkg.dest, n => /\.(ts|tsx|json|css|scss)$/.test(n));
}

// Map lib root files
for (const entry of LIB_ROOT) {
  const fullSrc = path.resolve(entry.src);
  const fullDest = path.resolve(entry.dest);
  if (fs.existsSync(fullSrc)) {
    if (fs.statSync(fullSrc).isDirectory()) {
      walkAndMap(entry.src, entry.dest, n => /\.(ts|tsx|json)$/.test(n));
    } else {
      addMapping(entry.src, entry.dest);
    }
  }
}

// Map types
walkAndMap(TYPES.src, TYPES.dest, n => /\.(ts|tsx)$/.test(n));

// ── Also map non-source files needed at build time ──────────────────
// These stay in place but we need to know where they are
// The env.d.ts for gnim type augmentation
if (fs.existsSync('src/env.d.ts')) {
  oldToNew.set(path.resolve('src/env.d.ts'), path.resolve('packages/core/src/env.d.ts'));
}

// ── Determine package for a given absolute path ─────────────────────

function getPackageFor(absPath) {
  for (const pkg of PACKAGES) {
    const destAbs = path.resolve(pkg.dest);
    if (absPath.startsWith(destAbs + path.sep) || absPath === destAbs) {
      return pkg;
    }
  }
  // Check in old locations too (some files might not be moved yet)
  for (const pkg of PACKAGES) {
    if (pkg.src) {
      const srcAbs = path.resolve(pkg.src);
      if (absPath.startsWith(srcAbs + path.sep) || absPath === srcAbs) {
        return pkg;
      }
    }
  }
  // Check lib root mappings
  for (const entry of LIB_ROOT) {
    if (path.resolve(entry.dest) === absPath) {
      const destPkg = PACKAGES.find(p => absPath.startsWith(path.resolve(p.dest) + path.sep));
      return destPkg;
    }
  }
  // Check types
  if (absPath.startsWith(path.resolve(TYPES.dest))) {
    return PACKAGES.find(p => p.name === 'packages/core');
  }
  return null;
}

// ── Build reverse map (new → old) for target resolution ────────────
const newToOld = new Map();
for (const [oldP, newP] of oldToNew) {
  newToOld.set(newP, oldP);
}

// ── Resolve import target given source file (old location) ─────────
function resolveTarget(oldFileAbs, importPath) {
  // Only resolve relative imports
  if (!importPath.startsWith('.') && !importPath.startsWith('..')) {
    return null; // Non-relative → leave alone
  }
  const dir = path.dirname(oldFileAbs);
  const target = path.resolve(dir, importPath);
  // Try with .ts, .tsx, /index.ts, /index.tsx
  const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
  for (const ext of extensions) {
    // The target might be a directory with an index file
    const candidate = target.endsWith(ext) ? target : target + ext;
    if (oldToNew.has(path.resolve(candidate))) {
      return path.resolve(candidate);
    }
  }
  // Also try without extension (the import itself might have no ext)
  if (!importPath.endsWith('.ts') && !importPath.endsWith('.tsx')) {
    const candidate = target;
    // Check if file exists at resolved path
    if (fs.existsSync(candidate + '.ts')) return path.resolve(candidate + '.ts');
    if (fs.existsSync(candidate + '.tsx')) return path.resolve(candidate + '.tsx');
    const indexTs = path.join(candidate, 'index.ts');
    const indexTsx = path.join(candidate, 'index.tsx');
    if (fs.existsSync(indexTs)) return path.resolve(indexTs);
    if (fs.existsSync(indexTsx)) return path.resolve(indexTsx);
  }
  return null;
}

// ── Convert a new target path to an import specifier ───────────────
function makeImportSpecifier(sourceNewAbs, targetNewAbs) {
  const sourcePkg = getPackageFor(sourceNewAbs);
  const targetPkg = getPackageFor(targetNewAbs);

  if (!sourcePkg || !targetPkg) {
    // If either is not in a known package, compute relative path
    return path.relative(path.dirname(sourceNewAbs), targetNewAbs).replace(/\.tsx?$/, '');
  }

  if (sourcePkg.name === targetPkg.name) {
    // Same package → relative path
    let rel = path.relative(path.dirname(sourceNewAbs), targetNewAbs);
    // Remove extension
    rel = rel.replace(/\.tsx?$/, '');
    if (!rel.startsWith('.')) rel = './' + rel;
    return rel;
  }

  // Different package → @shade/<pkg>/<subpath>
  const destDir = path.resolve(targetPkg.dest);
  const subPath = path.relative(destDir, targetNewAbs).replace(/\.tsx?$/, '');
  return `@shade/${targetPkg.tsName}/${subPath}`;
}

// ── Rewrite imports in a file ──────────────────────────────────────
function rewriteImportsInFile(filePath, oldAbsPath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Match import ... from '...' and export ... from '...'
  // Also handle re-exports: export {x} from '...'; export * from '...'
  const importRegex = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\}\s*from\s*|[\w\s*,{}\n]+\s+from\s*)['"]([^'"]+)['"];?/gm;
  const dynamicImportRegex = /import\(['"]([^'"]+)['"]\)/g;

  let replacements = [];

  // Static imports/exports
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const fullMatch = match[0];
    const importPath = match[1];

    if (!importPath.startsWith('.') && !importPath.startsWith('..')) continue;

    const targetAbs = resolveTarget(oldAbsPath, importPath);
    if (!targetAbs) continue; // Can't resolve

    const newTarget = oldToNew.get(targetAbs);
    if (!newTarget) continue; // Target wasn't moved

    const newSpec = makeImportSpecifier(path.resolve(filePath), newTarget);
    if (newSpec !== importPath) {
      replacements.push({from: importPath, to: newSpec, fullMatch, matchIndex: match.index});
    }
  }

  // Dynamic imports
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    const importPath = match[1];
    if (!importPath.startsWith('.') && !importPath.startsWith('..')) continue;

    const targetAbs = resolveTarget(oldAbsPath, importPath);
    if (!targetAbs) continue;

    const newTarget = oldToNew.get(targetAbs);
    if (!newTarget) continue;

    const newSpec = makeImportSpecifier(path.resolve(filePath), newTarget);
    if (newSpec !== importPath) {
      replacements.push({from: importPath, to: newSpec, fullMatch: match[0], matchIndex: match.index});
    }
  }

  // Apply replacements (reverse order to preserve indices)
  replacements.sort((a, b) => b.matchIndex - a.matchIndex);
  for (const r of replacements) {
    content = content.slice(0, r.matchIndex) +
      r.fullMatch.replace(r.from, r.to) +
      content.slice(r.matchIndex + r.fullMatch.length);
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    return replacements.length;
  }
  return 0;
}

// ── Ensure directories exist ──────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }
}

// ── Move files with git mv ────────────────────────────────────────
function gitMove(oldRel, newRel) {
  const oldAbs = path.resolve(oldRel);
  const newAbs = path.resolve(newRel);
  if (!fs.existsSync(oldAbs)) return;
  ensureDir(path.dirname(newAbs));
  try {
    execSync(`git mv "${oldRel}" "${newRel}"`, {stdio: 'pipe'});
    console.log(`  mv ${oldRel} → ${newRel}`);
  } catch (e) {
    console.error(`  FAILED mv ${oldRel} → ${newRel}: ${e.stderr?.toString().trim() || e.message}`);
  }
}

// ── Create package.json for a package ─────────────────────────────
function createPackageJson(pkgDir, shadeName, deps = {}) {
  const pkgPath = path.join(pkgDir, 'package.json');
  if (fs.existsSync(pkgPath)) return;
  const pkg = {
    name: shadeName,
    version: '0.1.0',
    private: true,
    type: 'module',
    dependencies: {
      'gnim': 'workspace:*',
      ...deps,
    },
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  wrote ${pkgPath}`);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

console.log('=== Phase 4: Physical package move ===\n');

// Step 1: Ensure destination directories
console.log('--- Step 1: Create directories ---');
for (const pkg of PACKAGES) {
  ensureDir(pkg.dest);
}
ensureDir(TYPES.dest);
for (const entry of LIB_ROOT) {
  ensureDir(path.dirname(entry.dest));
}
console.log('  directories created\n');

// Step 2: Move files with git mv
console.log('--- Step 2: Move files ---');
for (const pkg of PACKAGES) {
  if (!fs.existsSync(pkg.src)) continue;
  const files = fs.readdirSync(pkg.src);
  for (const f of files) {
    gitMove(`${pkg.src}/${f}`, `${pkg.dest}/${f}`);
  }
}
// Lib root files
for (const entry of LIB_ROOT) {
  if (fs.existsSync(entry.src)) {
    gitMove(entry.src, entry.dest);
  }
}
// Types
const typesFiles = fs.readdirSync(TYPES.src);
for (const f of typesFiles) {
  gitMove(`${TYPES.src}/${f}`, `${TYPES.dest}/${f}`);
}
// Old directories might still have remaining files after git mv; remove empties
for (const pkg of PACKAGES) {
  try { fs.rmdirSync(pkg.src); } catch {}
}
console.log('  files moved\n');

// Step 3: Rewrite imports in all moved .ts/.tsx files
console.log('--- Step 3: Rewrite imports ---');
let totalRewrites = 0;
let filesChanged = 0;

for (const [oldAbs, newAbs] of oldToNew) {
  const newPath = path.relative(ROOT, newAbs);
  if (!newPath.endsWith('.ts') && !newPath.endsWith('.tsx')) continue;
  if (!fs.existsSync(newAbs)) continue;

  const count = rewriteImportsInFile(newAbs, oldAbs);
  if (count > 0) {
    totalRewrites += count;
    filesChanged++;
    if (count <= 3) {
      console.log(`  ${newPath}: ${count} rewrites`);
    }
  }
}
console.log(`  ${filesChanged} files, ${totalRewrites} import rewrites\n`);

// Step 4: Create package.json files
console.log('--- Step 4: Create package.json files ---');
createPackageJson('packages/core', '@shade/core', {
  'gi-types': 'workspace:*',
});
createPackageJson('packages/services', '@shade/services', {
  '@shade/core': 'workspace:*',
});
createPackageJson('packages/widgets', '@shade/widgets', {
  '@shade/core': 'workspace:*',
  '@shade/services': 'workspace:*',
  '@shade/style': 'workspace:*',
});
createPackageJson('packages/style', '@shade/style', {
  '@shade/core': 'workspace:*',
});
createPackageJson('apps/shell', '@shade/shell', {
  '@shade/core': 'workspace:*',
  '@shade/services': 'workspace:*',
  '@shade/widgets': 'workspace:*',
  '@shade/style': 'workspace:*',
});
createPackageJson('apps/greeter', '@shade/greeter', {
  '@shade/core': 'workspace:*',
  '@shade/services': 'workspace:*',
});
createPackageJson('apps/share-picker', '@shade/share-picker', {
  '@shade/core': 'workspace:*',
  '@shade/services': 'workspace:*',
});
console.log('');

// Step 5: Update tsconfig.json with path aliases
console.log('--- Step 5: Update tsconfig.json ---');
const tsconfigPath = 'tsconfig.json';
const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));

if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};
tsconfig.compilerOptions.baseUrl = '.';
tsconfig.compilerOptions.paths = {
  '@shade/core/*': ['packages/core/src/*'],
  '@shade/services/*': ['packages/services/src/*'],
  '@shade/widgets/*': ['packages/widgets/src/*'],
  '@shade/style/*': ['packages/style/src/*'],
};

fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 4) + '\n');
console.log('  added paths aliases\n');

// Step 6: Update pnpm-workspace.yaml
console.log('--- Step 6: Update pnpm-workspace.yaml ---');
const workspaceYaml = `packages:
  - 'packages/*'
  - 'apps/*'

allowBuilds:
  esbuild: true
`;
fs.writeFileSync('pnpm-workspace.yaml', workspaceYaml);
console.log('  updated\n');

// Summary
console.log('=== Phase 4 codemod complete ===');
console.log('');
console.log('Next steps:');
console.log('  1. npx tsc --noEmit — verify types');
console.log('  2. npx madge --circular ... — verify 0 cycles');
console.log('  3. pnpm install — install workspace deps');
console.log('  4. pnpm run check:all — full CI gate');
