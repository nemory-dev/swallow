import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it as test } from 'vitest';

const script = fileURLToPath(new URL('../scripts/check-release-source.mjs', import.meta.url));
function repository(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'swallow-source-check-'));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', root]);
  for (const name of files) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), 'SYNTHETIC_PRIVATE_CONTENT_NEVER_PRINT\n');
  }
  execFileSync('git', ['-C', root, 'add', '--all']);
  return root;
}
function run(root) {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.ok(result.stdout.trim().startsWith('{'), 'checker must produce a JSON report');
  assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_CONTENT_NEVER_PRINT/);
  return { ...result, report: JSON.parse(result.stdout) };
}

test('missing root license and notices fail, even with a vendor license', t => {
  const root = repository(t, ['vendor/sdk/LICENSE', 'src/app.ts']);
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(result.report.status, 'fail');
  assert.equal(result.report.checks.find(x => x.id === 'root-license').status, 'fail');
  assert.equal(result.report.checks.find(x => x.id === 'third-party-notices').status, 'fail');
});

test('named sensitive files and artifacts fail without printing file content', t => {
  const root = repository(t, ['LICENSE', 'THIRD_PARTY_NOTICES.md', '.env.production', 'keys/release.p12', 'userData/library.sqlite', 'artifacts/Swallow.dmg']);
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.equal(report.blockedPathCount, 4);
});

test('synthetic PDF fixtures and env templates are allowed but rights remain on hold', t => {
  const root = repository(t, ['LICENSE.md', 'THIRD_PARTY_NOTICES.md', '.env.example', 'tests/fixtures/pdf/diagram.pdf', 'src/app.ts']);
  const { status, report } = run(root);
  assert.equal(status, 2);
  assert.equal(report.status, 'hold');
  assert.equal(report.blockedPathCount, 0);
  assert.equal(report.checks.find(x => x.id === 'rights-and-donations').status, 'hold');
});

test('unstaged/untracked files are excluded and Git state is preserved', t => {
  const root = repository(t, ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'src/app.ts']);
  writeFileSync(join(root, 'LICENSE'), 'unstaged change');
  writeFileSync(join(root, '.env.local'), 'SYNTHETIC_PRIVATE_CONTENT_NEVER_PRINT');
  const gitStatus = () => execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z']).toString();
  const before = gitStatus();
  const { report } = run(root);
  assert.equal(report.trackedPathCount, 3);
  assert.equal(report.blockedPathCount, 0);
  assert.equal(gitStatus(), before);
  assert.equal(report.checks.find(x => x.id === 'contents-history-and-final-index').status, 'hold');
});

test('newlines in tracked names do not hide blocked paths', t => {
  const root = repository(t, ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'artifacts/a\nb.zip']);
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.equal(report.blockedPathCount, 1);
});

test('outside a repository fails closed with no command output disclosure', t => {
  const root = mkdtempSync(join(tmpdir(), 'swallow-no-git-'));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const { status, report, stderr } = run(root);
  assert.equal(status, 1);
  assert.equal(report.status, 'fail');
  assert.equal(report.checks[0].id, 'git-index-readable');
  assert.equal(stderr, '');
});
