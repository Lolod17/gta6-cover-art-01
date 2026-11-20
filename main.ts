// Package Scene / 06 using Node's standard library and make.fun's unchanged dossier builder.
// Run with MAKEFUN_OUTPUT_DIR=/absolute/output/path node main.ts, or use the grader's /output.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

const sourceRoot = fileURLToPath(new URL('.', import.meta.url));
const outputRoot = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const root = resolve(sourceRoot);
if (outputRoot === root || ['app', 'screenshots', 'vendor'].some(name => {
  const input = join(root, name);
  return outputRoot === input || outputRoot.startsWith(input + sep);
})) throw new Error('MAKEFUN_OUTPUT_DIR must not overwrite or nest inside submission inputs.');

mkdirSync(outputRoot, { recursive: true });
for (const directory of ['app', 'screenshots']) {
  cpSync(join(sourceRoot, directory), join(outputRoot, directory), { recursive: true });
}

// Keep the scorer's exact text cap: it determines the canonical dossier bytes.
writeFileSync(
  join(outputRoot, 'dossier.json'),
  buildDossier(outputRoot, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    app_max_files: 993,
    app_max_bytes: 50331648,
    app_path_max_bytes: 1000,
  }),
);
