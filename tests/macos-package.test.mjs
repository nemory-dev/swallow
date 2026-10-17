import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertMacHost, stageMacApp } from '../scripts/macos-package.mjs';
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'swallow-package-test-')); roots.push(root);
  const put = async (path, content = 'fixture') => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), content); };
  const metadata = { name: 'swallow', version: '0.1.0', type: 'module', main: 'dist-electron/electron/main.js', license: 'MIT', dependencies: { runtime: '1.0.0' }, devDependencies: { tooling: '1.0.0' }, scripts: { private: 'secret' } };
  await put('package.json', JSON.stringify(metadata));
  await put('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { '': metadata, 'node_modules/runtime': { version: '1.0.0' }, 'node_modules/runtime/node_modules/nested': { version: '2.0.0' }, 'node_modules/tooling': { version: '1.0.0', dev: true } } }));
  for (const path of ['dist/assets/main.js', 'dist/private.db', 'dist/private.pdf', 'dist/assets/private.json', 'dist-electron/electron/stale.js', 'electron/main.ts', 'src/shared/types.ts', 'src/learning/document.ts', 'dist-electron/electron/main.js', 'dist-electron/electron/preload.cjs', 'dist-electron/src/shared/types.js', 'dist-electron/src/learning/document.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '.env', '.git/config', 'src/private.ts', 'docs/private.md', 'dist-electron/private.txt', 'node_modules/runtime/index.js', 'node_modules/runtime/node_modules/unlocked/index.js', 'node_modules/runtime/.bin/private', 'node_modules/tooling/index.js']) await put(path);
  await put('dist/index.html', '<script type="module" src="./assets/main.js"></script>');
  await put('dist-electron/native/swallow-pdf'); await chmod(join(root, 'dist-electron/native/swallow-pdf'), 0o755);
  await put('node_modules/runtime/package.json', JSON.stringify({ name: 'runtime', version: '1.0.0' }));
  await put('node_modules/runtime/node_modules/nested/package.json', JSON.stringify({ name: 'nested', version: '2.0.0' }));
  await put('node_modules/runtime/node_modules/nested/index.js');
  return { root, put, stage: join(root, 'stage'), native: join(root, 'native-stage') };
}
const stage = stageMacApp;
describe('macOS 앱의 배포 파일 선별', () => {
  it('빌드 결과와 잠긴 production 의존성만 포함한다', async () => {
    const input = await fixture(); await stage(input);
    expect(await readdir(input.stage).catch(() => [])).toEqual(['LICENSE', 'THIRD_PARTY_NOTICES.md', 'dist', 'dist-electron', 'node_modules', 'package.json']);
    expect(await readdir(join(input.stage, 'dist'))).toEqual(['assets', 'index.html']);
    expect(await readdir(join(input.stage, 'dist/assets'))).toEqual(['main.js']);
    expect(await readdir(join(input.stage, 'dist-electron/electron'))).toEqual(['main.js', 'preload.cjs']);
    expect(await readdir(join(input.stage, 'node_modules'))).toEqual(['runtime']);
    expect(await readdir(join(input.stage, 'node_modules/runtime/node_modules'))).toEqual(['nested']);
    expect(await readdir(join(input.stage, 'node_modules/runtime'))).not.toContain('.bin');
    expect(await readdir(join(input.stage, 'dist-electron'))).toEqual(['electron', 'src']);
    const metadata = JSON.parse(await readFile(join(input.stage, 'package.json'), 'utf8'));
    expect(metadata).toEqual({ name: 'swallow', version: '0.1.0', type: 'module', main: 'dist-electron/electron/main.js', license: 'MIT' });
    expect(await readFile(join(input.native, 'swallow-pdf'), 'utf8')).toBe('fixture');
  });
  it('helper가 없거나 실행 권한이 없으면 재빌드를 안내한다', async () => {
    const input = await fixture(); await chmod(join(input.root, 'dist-electron/native/swallow-pdf'), 0o644);
    await expect(stage(input)).rejects.toThrow(/PDF.*build/);
    await rm(join(input.root, 'dist-electron/native/swallow-pdf'));
    await expect(stage(input)).rejects.toThrow(/PDF.*build/);
  });
  it('설치된 production 의존성 누락과 버전 불일치를 거절한다', async () => {
    const input = await fixture(); await input.put('node_modules/runtime/package.json', '{"name":"runtime","version":"9.0.0"}');
    await expect(stage(input)).rejects.toThrow(/runtime.*npm ci/);
    await rm(join(input.root, 'node_modules/runtime'), { recursive: true });
    await expect(stage(input)).rejects.toThrow(/runtime.*npm ci/);
  });
  it('allowlist 내부 symlink와 잠금 파일의 경로 이탈을 거절한다', async () => {
    const input = await fixture(); await symlink(join(input.root, '.env'), join(input.root, 'dist/assets/secret.js'));
    await input.put('dist/index.html', '<script src="./assets/secret.js"></script>');
    await expect(stage(input)).rejects.toThrow(/symbolic link/);
    await rm(join(input.root, 'dist/assets/secret.js'));
    await input.put('dist/index.html', '<script src="./assets/main.js"></script>');
    await rm(join(input.root, 'dist/assets/main.js'));
    await symlink(join(input.root, '.env'), join(input.root, 'dist/assets/main.js'));
    await expect(stage(input)).rejects.toThrow(/symbolic link/);
    await rm(join(input.root, 'dist/assets/main.js'));
    await input.put('dist/assets/main.js');
    const lock = JSON.parse(await readFile(join(input.root, 'package-lock.json'), 'utf8'));
    lock.packages['node_modules/../../private'] = { version: '1.0.0' }; await input.put('package-lock.json', JSON.stringify(lock));
    await expect(stage(input)).rejects.toThrow(/dependency path/);
  });
});

describe('패키징 실행 환경', () => {
  it('다른 플랫폼·아키텍처·Node 주 버전에서 일찍 중단한다', async () => {
    const check = assertMacHost;
    expect(() => check({ platform: 'linux', arch: 'arm64', node: '24.22.0' })).toThrow(/macOS/);
    expect(() => check({ platform: 'darwin', arch: 'x64', node: '24.22.0' })).toThrow(/arm64/);
    expect(() => check({ platform: 'darwin', arch: 'arm64', node: '22.0.0' })).toThrow(/Node 24/);
    expect(() => check({ platform: 'darwin', arch: 'arm64', node: '24.22.0' })).not.toThrow();
  });
});

// Build trees may contain stale compiler outputs or accidentally copied personal files.
it('renderer 참조가 누락되거나 dist 밖을 가리키면 중단한다', async () => {
  const input = await fixture();
  await input.put('dist/index.html', '<script src="./assets/missing.js"></script>');
  await expect(stage(input)).rejects.toThrow(/missing.js/);
  await input.put('dist/index.html', '<script src="../private.js"></script>');
  await expect(stage(input)).rejects.toThrow(/renderer asset/);
});
