import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as standalone from '../dist/exact-time.mjs';

// 2026-11-23: the tagged source lacked its exported builds. Review by: 2027-02-23 (protects: user)
const { name, version } = JSON.parse(await readFile('package.json', 'utf8'));
const tarball = `${name}-${version}.tgz`;
const assets = (await readdir('dist')).filter(file => file !== 'SHA256SUMS').sort();
assert.ok(assets.includes(tarball), `missing versioned release asset ${tarball}`);
const sums = [];
for (const file of assets) {
  const bytes = await readFile(join('dist', file));
  sums.push(createHash('sha256').update(bytes).digest('hex') + '  ' + file);
}
const manifest = await readFile('dist/SHA256SUMS', 'utf8');
assert.deepEqual(manifest.trimEnd().split('\n').sort(), sums.sort(), 'SHA256SUMS must fingerprint each release asset exactly once');
console.log(`SHA256SUMS verified for all ${assets.length} assets including ${tarball}`);

const consumer = await mkdtemp(join(tmpdir(), 'exact-time-consumer-'));
try {
  const dependency = pathToFileURL(resolve('dist', tarball)).href;
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, dependencies: { [name]: dependency } }));
  execSync('npm install --offline --ignore-scripts --no-audit --no-fund', { cwd: consumer, stdio: 'inherit' });

  const installed = join(consumer, 'node_modules', name);
  const pkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(pkg.name, name);
  assert.equal(pkg.version, version);
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.ok(!Object.hasOwn(pkg.scripts ?? {}, hook), `packed package declares ${hook} script`);
  }
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.deepEqual(Object.keys(pkg[key] ?? {}), [], `packed package declares ${key}`);
  }

  // Resolve both entry points from the consumer. API parity checks the standalone names.
  const expectedNames = Object.keys(standalone).sort();
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    for (const api of [require('exact-time'), await import('exact-time')]) {
      assert.deepEqual(Object.keys(api).sort(), ${JSON.stringify(expectedNames)});
      assert.throws(() => api.fromTicks('source', '1', { num: 25, den: 1 }), { code: 'NOT_ON_FRAME_BOUNDARY' });
    }
  `], { cwd: consumer, stdio: 'inherit' });

  const fixture = `
    import { type FrameRate, type TimecodeSpec, type MediaClock, MEDIA_CLOCKS, mediaClockSchema, rateSchema, timecodeSpecSchema, fromTicks } from 'exact-time';
    const rate: FrameRate = rateSchema.parse({ num: 25, den: 1 });
    const spec: TimecodeSpec = timecodeSpecSchema.parse({ rate, dropFrame: false, rateOrigin: 'declared' });
    const names: readonly ['source', 'reel', 'timeline'] = MEDIA_CLOCKS;
    const clock: MediaClock = mediaClockSchema.parse(names[0]);
    // @ts-expect-error A fourth name is outside the clock union.
    const unknownClock: MediaClock = 'day';
    // @ts-expect-error The exported tuple is read-only.
    MEDIA_CLOCKS[0] = 'source';
    fromTicks(clock, '0', spec.rate);
  `;
  for (const file of ['use.mts', 'use.cts']) await writeFile(join(consumer, file), fixture);
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--strict', '--noEmit',
    '--module', 'NodeNext', '--target', 'es2022', 'use.mts', 'use.cts'], { cwd: consumer, stdio: 'inherit' });

  for (const file of ['exact-time.cjs', 'exact-time.mjs', 'exact-time.d.cts', 'exact-time.d.mts', 'time-cases.json']) {
    const packed = await readFile(join(installed, 'dist', file));
    assert.ok(packed.equals(await readFile(join('dist', file))), `packed ${file} differs from standalone`);
  }
  console.log(`npm installed ${tarball}: require/import matched ${expectedNames.length} exports and NOT_ON_FRAME_BOUNDARY; both declaration formats type-checked; packed builds matched standalone`);
} finally {
  await rm(consumer, { recursive: true, force: true });
}
