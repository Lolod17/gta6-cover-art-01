import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from '../vendor/makefun-app.ts';

const repository = fileURLToPath(new URL('../', import.meta.url));
const kit = resolve(repository, '../kit');
const scratch = mkdtempSync('/var/folders/qn/xwy5j1td2z5fdt1fxgt44p9h0000gn/T/opencode/scene06-package-');
const caps = { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, app_max_files: 993, app_max_bytes: 50331648, app_path_max_bytes: 1000 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function manifest(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name), relative = prefix + name, metadata = lstatSync(path);
    assert.ok(metadata.isDirectory() || metadata.isFile(), `Not a plain file/directory: ${path}`);
    if (metadata.isDirectory()) return [{ path: relative + '/', bytes: 0 }, ...manifest(path, relative + '/')];
    return [{ path: relative, bytes: metadata.size, sha256: hash(readFileSync(path)) }];
  });
}

const before = manifest(join(repository, 'app'));
const runs = ['first', 'second'].map(name => {
  const output = join(scratch, name);
  const result = spawnSync(process.execPath, ['main.ts'], { cwd: repository, env: { ...process.env, MAKEFUN_OUTPUT_DIR: output }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const dossier = readFileSync(join(output, 'dossier.json'));
  assert.ok(dossier.equals(Buffer.from(buildDossier(output, caps))), 'Canonical dossier mismatch');
  assert.ok(dossier.length <= 1572864, 'Dossier exceeds 1.5 MiB');
  assert.deepEqual(manifest(join(output, 'app')), before, 'Copied app differs from source');
  assert.deepEqual(manifest(join(output, 'screenshots')), manifest(join(repository, 'screenshots')), 'Copied screenshots differ');
  return { output, dossierBytes: dossier.length, dossierSha256: hash(dossier), files: manifest(output) };
});
assert.deepEqual(runs[0].files, runs[1].files, 'Packaging runs differ');
assert.deepEqual(manifest(join(repository, 'app')), before, 'Source app was modified');
assert.ok(runs[0].files.length <= 1000);
const outputBytes = runs[0].files.reduce((total, item) => total + item.bytes, 0);
assert.ok(outputBytes <= 67108864);
writeFileSync(join(repository, 'tools/step-6-package.json'), JSON.stringify({
  output: runs[0].output, repeatOutput: runs[1].output,
  identicalRuns: true, appUnchanged: true, outputEntries: runs[0].files.length, outputBytes,
  dossierBytes: runs[0].dossierBytes, dossierSha256: runs[0].dossierSha256,
  appManifest: before,
}, null, 2) + '\n');
console.log(`Two byte-identical builds: ${runs[0].files.length} output entries, ${outputBytes} bytes.`);
console.log(`Canonical dossier: ${runs[0].dossierBytes} bytes; SHA-256 ${runs[0].dossierSha256}`);
console.log(`Output retained at ${runs[0].output}`);

for (const [name, args] of [
  ['step-6-kit-check.txt', ['cli/makefun.mjs', 'check', '--kit', '.', '--repo', repository, '--worktree']],
  ['step-6-kit-gate.txt', ['cli/makefun.mjs', 'grade-local', '--kit', '.', '--bot', repository, '--driver', 'process', '--worktree']],
]) {
  const result = spawnSync(process.execPath, args, { cwd: kit, env: { ...process.env, MAKEFUN_OFFLINE: '1' }, encoding: 'utf8', timeout: 60000 });
  const raw = (result.stdout || '') + (result.stderr || '');
  writeFileSync(join(repository, 'tools', name), raw);
  console.log(`\n$ MAKEFUN_OFFLINE=1 node ${args.join(' ')}\n${raw}Exit status: ${result.status}`);
  if (result.error) throw result.error;
}
