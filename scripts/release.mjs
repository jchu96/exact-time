import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { build } from 'tsup';

await build({
  entry: ['src/exact-time.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist',
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
  target: 'es2022',
  clean: true,
  dts: true,
  splitting: false,
});

await rename('dist/exact-time.d.ts', 'dist/exact-time.d.mts');
for (const source of ['python/exact_time.py', 'es3/exact-time.jsx', 'contracts/time-cases.json']) {
  await copyFile(source, join('dist', basename(source)));
}
execSync('npm pack --ignore-scripts --pack-destination dist', { stdio: 'inherit' });
// npm pack automatically includes nested licenses. The tarball already has the root LICENSE.
await copyFile('LICENSE', 'dist/LICENSE');
const sums = [];
for (const name of (await readdir('dist')).sort()) {
  const digest = createHash('sha256').update(await readFile(join('dist', name))).digest('hex');
  sums.push(`${digest}  ${name}`);
}
await writeFile('dist/SHA256SUMS', sums.join('\n') + '\n');
