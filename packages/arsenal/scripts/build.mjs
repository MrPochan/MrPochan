import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'dist', 'arsenal.html');
const scriptTag = '<script type="module" src="./src/main.ts"></script>';

const result = await esbuild.build({
  entryPoints: [join(root, 'src', 'main.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
  write: false,
});
const js = result.outputFiles[0].text;
if (js.includes('</script')) {
  throw new Error('bundled JS contains "</script", cannot inline safely');
}

const template = readFileSync(join(root, 'index.html'), 'utf8');
if (!template.includes(scriptTag)) {
  throw new Error('script tag not found in index.html');
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, template.replace(scriptTag, () => `<script>\n${js}</script>`));
console.log(`built ${outFile}`);
