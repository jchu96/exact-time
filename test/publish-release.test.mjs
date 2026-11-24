import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const script = resolve('scripts/publish-release.sh');

// Runs the real publish script with a stand-in `gh` that records its arguments.
function publishArgs(tag) {
  const root = mkdtempSync(join(tmpdir(), 'publish-release-'));
  try {
    mkdirSync(join(root, 'bin'));
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist', 'SHA256SUMS'), '');
    writeFileSync(join(root, 'bin', 'gh'), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$GH_ARGS_FILE"\n');
    chmodSync(join(root, 'bin', 'gh'), 0o755);
    const env = { PATH: `${join(root, 'bin')}:${process.env.PATH}`, GH_ARGS_FILE: join(root, 'args') };
    if (tag !== undefined) env.GITHUB_REF_NAME = tag;
    execFileSync('bash', [script], { cwd: root, env, stdio: 'pipe' });
    return readFileSync(join(root, 'args'), 'utf8').split('\n').filter(Boolean);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it('publishes a tag with a pre-release suffix as a pre-release that is not Latest', () => {
  for (const [tag, pre] of [['v1.2.3-beta.1', true], ['v1.2.3-rc.1+build', true], ['v1.2.3', false], ['v1.2.3+build-a', false]]) {
    const args = publishArgs(tag);
    expect(args.slice(0, 4), tag).toEqual(['release', 'create', tag, 'dist/SHA256SUMS']);
    expect(args.includes('--prerelease'), `${tag} --prerelease`).toBe(pre);
    expect(args.includes('--latest=false'), `${tag} --latest=false`).toBe(pre);
    expect(args.includes('--verify-tag'), `${tag} --verify-tag`).toBe(true);
  }
});

it('refuses to publish without a tag name', () => {
  expect(() => publishArgs(undefined)).toThrow();
});

it('the release job publishes only through the script', () => {
  const workflow = readFileSync('.github/workflows/check.yml', 'utf8');
  const release = workflow.split('\n  release:\n')[1];
  expect(release).toContain('\n      - run: bash scripts/publish-release.sh\n');
  expect(workflow).not.toContain('gh release create');
});
