import { afterEach, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyMacBundle } from '../scripts/macos-signing.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe.skipIf(process.platform !== 'darwin')('macOS 앱 리소스 무결성 검사', () => {
  it('봉인되지 않은 앱과 서명 후 변경된 리소스를 거절한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'swallow-signature-test-')); roots.push(root);
    const app = join(root, 'Fixture.app');
    await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
    await mkdir(join(app, 'Contents/Resources'), { recursive: true });
    await copyFile('/usr/bin/true', join(app, 'Contents/MacOS/Fixture'));
    await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Fixture</string>
<key>CFBundleIdentifier</key><string>io.github.nemory-dev.swallow.test</string>
<key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
    const resource = join(app, 'Contents/Resources/content.txt');
    await writeFile(resource, 'original');
    expect(() => verifyMacBundle(app)).toThrow(/무결성/);
    const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', app], { encoding: 'utf8' });
    expect(signed.status, signed.stderr).toBe(0);
    expect(() => verifyMacBundle(app)).not.toThrow();
    await writeFile(resource, 'tampered');
    expect(() => verifyMacBundle(app)).toThrow(/무결성/);
  });
});
