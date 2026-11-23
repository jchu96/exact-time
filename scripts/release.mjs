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
for (const source of ['python/exact_time.py', 'es3/exact-time.jsx', 'contracts/time-cases.json', 'LICENSE']) {
  await copyFile(source, join('dist', basename(source)));
}
const sums = [];
for (const name of (await readdir('dist')).sort()) {
  const digest = createHash('sha256').update(await readFile(join('dist', name))).digest('hex');
  sums.push(`${digest}  ${name}`);
}
await writeFile('dist/SHA256SUMS', sums.join('\n') + '\n');
