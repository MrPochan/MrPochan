import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const buildDir = join(root, '.build');
const outFile = join(root, 'dist', 'starship.html');
const scriptTag = '<script type="module" src="./src/main.ts"></script>';

rmSync(buildDir, { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], { stdio: 'inherit' });

const js = readFileSync(join(buildDir, 'main.js'), 'utf8');
if (js.includes('</script')) {
  throw new Error('compiled JS contains "</script", cannot inline safely');
}

const template = readFileSync(join(root, 'index.html'), 'utf8');
if (!template.includes(scriptTag)) {
  throw new Error('script tag not found in index.html');
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, template.replace(scriptTag, () => `<script type="module">\n${js}</script>`));
rmSync(buildDir, { recursive: true, force: true });
console.log(`built ${outFile}`);
